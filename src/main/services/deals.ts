import { getDb } from '../db'
import { REAL_TX } from './filters'
import { getSetting, getSettingNumber, setSetting } from './settings'
import { localIsoDate, todayLocalIso } from './dates'
import { listPolicies } from './insurance'
import { sendDiscordMessage } from './discord'
import { track } from './health'
import { SEED_PLANS, SEED_VERIFIED_AT, COMPARE_LINKS } from './deal-catalogue'
import {
  annualise,
  bestSaving,
  daysBetweenIso,
  needsRenewalReview,
  rankPlans,
  round2
} from './deal-math'
import type {
  DealCategory,
  DealComparison,
  DealPlan,
  DealPlanInput,
  DealsReport,
  RenewalReview
} from '@shared/types'

/**
 * Deal comparison.
 *
 * The catalogue only contains prices that were read from a page the app can
 * actually fetch (see `deal-catalogue.ts`). Nothing here invents a rate: power
 * is address-priced, so it ships empty and the user adds plans from a bill.
 *
 * A weekly refresh re-fetches each plan's `sourceUrl` and marks the plan stale
 * when the provider is no longer on the page. It never rewrites a price, and
 * the UI shows the date each price was verified.
 */

const SEEDED_KEY = 'DEALS_SEEDED'
const LAST_CHECK_KEY = 'DEALS_LAST_CHECK'
const USAGE_KEY = 'POWER_MONTHLY_KWH'

const DEFAULT_KWH = 400
const USAGE_MIN = 1
const USAGE_MAX = 5000
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000
const BILL_WINDOW_DAYS = 150

const LABELS: Record<DealCategory, string> = {
  power: 'Power',
  broadband: 'Broadband',
  mobile: 'Mobile'
}

/**
 * A bill this high is not plausible for the category. It usually means one
 * charge covers more than one service (e.g. a Slingshot power + internet
 * invoice), so it's shown but not used as a like-for-like price.
 */
const PLAUSIBLE_MAX: Record<DealCategory, number> = {
  power: 800,
  broadband: 250,
  mobile: 150
}

interface ProviderDef {
  name: string
  aliases: string[]
  categories: DealCategory[]
}

/**
 * Retailers the app can recognise from a bank description. When a retailer
 * sells more than one product the transaction's own text or Akahu category
 * decides which one it is; the first entry is the fallback.
 */
const PROVIDERS: ProviderDef[] = [
  { name: 'Contact Energy', aliases: ['contact energy'], categories: ['power'] },
  { name: 'Genesis Energy', aliases: ['genesis energy'], categories: ['power'] },
  { name: 'Mercury', aliases: ['mercury energy'], categories: ['power'] },
  { name: 'Meridian', aliases: ['meridian energy'], categories: ['power'] },
  { name: 'Electric Kiwi', aliases: ['electric kiwi'], categories: ['power'] },
  { name: 'Octopus Energy', aliases: ['octopus energy'], categories: ['power'] },
  { name: 'Powershop', aliases: ['powershop'], categories: ['power'] },
  { name: 'Manawa Energy', aliases: ['manawa energy', 'trustpower'], categories: ['power'] },
  { name: 'Nova Energy', aliases: ['nova energy'], categories: ['power'] },
  { name: 'Ecotricity', aliases: ['ecotricity'], categories: ['power'] },
  { name: 'Frank Energy', aliases: ['frank energy'], categories: ['power'] },
  { name: 'Slingshot', aliases: ['slingshot'], categories: ['broadband', 'power'] },
  { name: '2degrees', aliases: ['2degrees', '2 degrees'], categories: ['mobile', 'broadband', 'power'] },
  { name: 'One NZ', aliases: ['one nz', 'one new zealand', 'vodafone'], categories: ['mobile', 'broadband'] },
  { name: 'Spark', aliases: ['spark new zealand', 'spark nz'], categories: ['mobile', 'broadband'] },
  { name: 'Skinny', aliases: ['skinny'], categories: ['mobile', 'broadband'] },
  { name: 'Orcon', aliases: ['orcon'], categories: ['broadband'] },
  { name: 'Bigpipe', aliases: ['bigpipe'], categories: ['broadband'] },
  { name: 'MyRepublic', aliases: ['myrepublic'], categories: ['broadband'] },
  { name: 'Rocket Mobile', aliases: ['rocket mobile'], categories: ['mobile'] },
  { name: 'Kogan Mobile', aliases: ['kogan mobile'], categories: ['mobile'] },
  { name: 'Warehouse Mobile', aliases: ['warehouse mobile'], categories: ['mobile'] }
]

const HINTS: Array<[DealCategory, RegExp]> = [
  ['power', /\b(power|electric(ity)?|energy|kwh)\b/i],
  ['broadband', /\b(broadband|internet|fibre|fiber|wifi|wireless)\b/i],
  ['mobile', /\b(mobile|phone|cellular|prepay)\b/i]
]

interface TxRow {
  date: string
  description: string | null
  merchant: string | null
  amount: number
  category: string | null
}

interface ClassifiedTx extends TxRow {
  provider: string
}

interface CurrentBill {
  provider: string | null
  monthly: number | null
  note: string | null
}

// ------------------------------------------------------------------ seeding

/** Insert the shipped catalogue once. User deletions must survive restarts. */
export function seedDeals(): void {
  if (getSetting(SEEDED_KEY) === '1') return
  const db = getDb()
  const insert = db.prepare(
    `INSERT OR IGNORE INTO deal_plans
       (category, provider, plan_name, monthly_price, variable_rate, daily_charge, region, source_url, verified_at, stale, notes, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`
  )
  const now = Date.now()
  db.transaction(() => {
    for (const p of SEED_PLANS) {
      insert.run(
        p.category,
        p.provider,
        p.planName,
        p.monthlyPrice,
        p.variableRate,
        p.dailyCharge,
        p.region,
        p.sourceUrl,
        p.sourceUrl ? SEED_VERIFIED_AT : now,
        p.notes
      )
    }
    setSetting(SEEDED_KEY, '1')
  })()
}

// ---------------------------------------------------------------- reporting

function planFromRow(r: Record<string, unknown>): DealPlan {
  return {
    id: r.id as number,
    category: r.category as DealCategory,
    provider: r.provider as string,
    planName: r.plan_name as string,
    monthlyPrice: (r.monthly_price as number) ?? null,
    variableRate: (r.variable_rate as number) ?? null,
    dailyCharge: (r.daily_charge as number) ?? null,
    region: (r.region as string) ?? null,
    sourceUrl: (r.source_url as string) ?? null,
    verifiedAt: (r.verified_at as number) ?? null,
    stale: r.stale === 1,
    notes: (r.notes as string) ?? null
  }
}

function listPlans(category: DealCategory): DealPlan[] {
  const rows = getDb()
    .prepare(
      `SELECT id, category, provider, plan_name, monthly_price, variable_rate, daily_charge,
              region, source_url, verified_at, stale, notes
       FROM deal_plans WHERE category = ? AND active = 1
       ORDER BY provider COLLATE NOCASE, plan_name COLLATE NOCASE`
    )
    .all(category) as Array<Record<string, unknown>>
  return rows.map(planFromRow)
}

function lastChecked(): number | null {
  const raw = getSetting(LAST_CHECK_KEY, '')
  const n = Number(raw)
  if (raw && Number.isFinite(n) && n > 0) return n
  // No refresh yet: fall back to the newest page-verified date in the
  // catalogue so the screen never claims the prices are unchecked when they
  // were seeded. Manually entered plans don't count as a page check.
  const row = getDb()
    .prepare(
      'SELECT MAX(verified_at) AS t FROM deal_plans WHERE verified_at IS NOT NULL AND source_url IS NOT NULL'
    )
    .get() as { t: number | null } | undefined
  return row?.t ?? null
}

/** Only the timestamp of the last actual page refresh (no seed fallback). */
function lastRefreshAt(): number | null {
  const raw = getSetting(LAST_CHECK_KEY, '')
  const n = Number(raw)
  return raw && Number.isFinite(n) && n > 0 ? n : null
}

export function getPowerUsage(): number {
  const n = getSettingNumber(USAGE_KEY, DEFAULT_KWH)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_KWH
  return Math.min(USAGE_MAX, Math.max(USAGE_MIN, n))
}

function powerUsageIsDefault(): boolean {
  return getSetting(USAGE_KEY, '') === ''
}

/**
 * Work out which retailer is currently being paid for a category and what the
 * average monthly bill is, using complete calendar months so an in-progress
 * month doesn't drag the figure down.
 */
function detectCurrent(category: DealCategory): CurrentBill {
  const db = getDb()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - BILL_WINDOW_DAYS)
  const rows = db
    .prepare(
      `SELECT date, description, merchant, amount, category FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? ORDER BY date DESC`
    )
    .all(localIsoDate(cutoff)) as TxRow[]

  const matched: ClassifiedTx[] = []
  for (const r of rows) {
    const cls = classify(r)
    if (cls && cls.category === category) matched.push({ ...r, provider: cls.provider })
  }
  if (matched.length === 0) return { provider: null, monthly: null, note: null }

  // The most recent debit is the best signal for who you're with now — a
  // switch mid-window shouldn't keep reporting the old retailer.
  const provider = matched[0].provider

  const providerRows = matched.filter((r) => r.provider === provider)
  const monthly = recentMonthlyAverage(providerRows, todayLocalIso())
  if (monthly === null) return { provider, monthly: null, note: null }

  if (monthly > PLAUSIBLE_MAX[category]) {
    return {
      provider,
      monthly: null,
      note: `The ${provider} charges we can see average $${monthly.toFixed(2)}/month, which is too high for ${LABELS[
        category
      ].toLowerCase()} alone. Treat it as a bundle rather than a like-for-like price.`
    }
  }
  return { provider, monthly, note: null }
}

/** Average total per complete calendar month over the last `months` months. */
function recentMonthlyAverage(rows: TxRow[], today: string, months = 3): number | null {
  if (rows.length === 0) return null
  const keys: string[] = []
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1)
  for (let i = 1; i <= months; i++) {
    d.setMonth(d.getMonth() - 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const totals = new Map(keys.map((k) => [k, 0]))
  for (const r of rows) {
    const key = r.date.slice(0, 7)
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + Math.abs(r.amount))
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0)
  if (sum === 0) return null
  return round2(sum / months)
}

function classify(r: TxRow): { provider: string; category: DealCategory } | null {
  const hay = `${r.description ?? ''} ${r.merchant ?? ''}`.toLowerCase()
  const def = PROVIDERS.find((p) => p.aliases.some((a) => hay.includes(a)))
  if (!def) return null

  const hinted = new Set<DealCategory>()
  for (const [cat, re] of HINTS) if (re.test(hay)) hinted.add(cat)
  const akahu = (r.category ?? '').toLowerCase()
  if (akahu.includes('internet')) hinted.add('broadband')
  else if (akahu.includes('telecom')) hinted.add('mobile')
  else if (akahu.includes('electric') || akahu.includes('utilit')) hinted.add('power')

  const matches = def.categories.filter((c) => hinted.has(c))
  return { provider: def.name, category: matches[0] ?? def.categories[0] }
}

function buildComparison(category: DealCategory): DealComparison {
  const plans = listPlans(category)
  const kwh = getPowerUsage()
  const bill = detectCurrent(category)
  const ranked = rankPlans(plans, {
    currentMonthly: bill.monthly,
    kwh,
    currentProvider: bill.provider
  })

  const notes: string[] = []
  if (bill.note) notes.push(bill.note)
  if (plans.length === 0) {
    notes.push(
      category === 'power'
        ? 'Power is priced per address and lines network, so no rates are preloaded. Add your current plan and a competing one from a recent bill — the ranking is exact once your monthly usage is set.'
        : `No ${LABELS[category].toLowerCase()} plans are loaded yet. Add one from a retailer page or a recent bill.`
    )
  } else if (bill.monthly === null && !bill.note) {
    notes.push(
      `We couldn't identify a ${LABELS[category].toLowerCase()} bill in the last few months, so plans are listed cheapest first rather than as a saving.`
    )
  }
  if (category === 'power' && powerUsageIsDefault()) {
    notes.push(`Using an estimated ${kwh} kWh/month — set your real usage for an exact comparison.`)
  }
  const stale = plans.filter((p) => p.stale).length
  if (stale > 0) {
    notes.push(
      `${stale} price${stale === 1 ? '' : 's'} could not be confirmed on the retailer's page at the last check — verify before switching.`
    )
  }

  return {
    category,
    label: LABELS[category],
    currentProvider: bill.provider,
    currentMonthly: bill.monthly,
    usageKwh: category === 'power' ? kwh : null,
    offers: ranked.map((r) => ({
      plan: r.plan,
      monthlyCost: r.monthlyCost,
      monthlySaving: r.monthlySaving,
      annualSaving: r.annualSaving,
      isCurrent: r.isCurrent
    })),
    bestSaveMonthly: bestSaving(ranked),
    bestSaveAnnual: annualise(bestSaving(ranked)),
    lastChecked: lastChecked(),
    staleCount: stale,
    note: notes.length > 0 ? notes.join(' ') : null
  }
}

function upcomingRenewals(days = 30): RenewalReview[] {
  const today = todayLocalIso()
  return listPolicies()
    .filter((p) => p.renewalDate)
    .map((p) => ({
      policyId: p.id,
      provider: p.provider,
      coverType: p.coverType,
      renewalDate: p.renewalDate as string,
      daysAway: daysBetweenIso(today, p.renewalDate as string),
      premium: p.premium,
      frequency: p.frequency
    }))
    .filter((r) => r.daysAway >= 0 && r.daysAway <= days)
    .sort((a, b) => a.daysAway - b.daysAway)
}

export function getDealsReport(): DealsReport {
  seedDeals()
  return {
    comparisons: (['power', 'broadband', 'mobile'] as DealCategory[]).map(buildComparison),
    renewals: upcomingRenewals(),
    lastChecked: lastChecked(),
    powerUsageKwh: getPowerUsage()
  }
}

// ------------------------------------------------------------- price refresh

/**
 * Re-check every plan that has a source URL. One fetch per URL, then every
 * plan pointing at it is updated together. A missing provider means the page
 * changed or the plan was withdrawn, so the plan is flagged stale — its price
 * is left alone and the UI shows the last verified date.
 */
export async function refreshDealPrices(): Promise<DealsReport> {
  seedDeals()
  const db = getDb()
  const plans = (db
    .prepare('SELECT id, provider, source_url FROM deal_plans WHERE active = 1 AND source_url IS NOT NULL')
    .all() as Array<{ id: number; provider: string; source_url: string }>)

  const byUrl = new Map<string, Array<{ id: number; provider: string }>>()
  for (const p of plans) {
    const arr = byUrl.get(p.source_url)
    if (arr) arr.push({ id: p.id, provider: p.provider })
    else byUrl.set(p.source_url, [{ id: p.id, provider: p.provider }])
  }

  const now = Date.now()
  const okUpdate = db.prepare('UPDATE deal_plans SET stale = 0, verified_at = ? WHERE id = ?')
  const staleUpdate = db.prepare('UPDATE deal_plans SET stale = 1 WHERE id = ?')

  let reached = 0
  for (const [url, items] of byUrl) {
    let html: string | null = null
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'FinanceBot/1.0 (personal deal check)' },
        signal: AbortSignal.timeout(15_000)
      })
      if (res.ok) html = (await res.text()).toLowerCase()
    } catch {
      html = null
    }
    if (html !== null && html.length > 500) reached++
    for (const item of items) {
      const found = html !== null && html.length > 500 && html.includes(item.provider.toLowerCase())
      if (found) okUpdate.run(now, item.id)
      else staleUpdate.run(item.id)
    }
  }

  // A total network failure must not look like a successful weekly check —
  // let the scheduler record it and retry on the next run.
  if (byUrl.size > 0 && reached === 0) {
    throw new Error('Could not reach any retailer price page.')
  }
  if (reached > 0) setSetting(LAST_CHECK_KEY, String(now))
  return getDealsReport()
}

// ---------------------------------------------------------------- mutations

function validUrl(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function addDealPlan(input: DealPlanInput): DealsReport {
  const category = input.category
  if (category !== 'power' && category !== 'broadband' && category !== 'mobile') {
    throw new Error('Unknown deal category.')
  }
  const provider = (input.provider ?? '').trim()
  const planName = (input.planName ?? '').trim()
  if (!provider || !planName) throw new Error('Provider and plan name are required.')

  let monthlyPrice: number | null = null
  let variableRate: number | null = null
  let dailyCharge: number | null = null

  if (category === 'power') {
    const rate = Number(input.variableRate)
    const daily = Number(input.dailyCharge)
    if (!Number.isFinite(rate) || rate < 0 || rate > 2) {
      throw new Error('Enter the per-kWh rate in dollars (for example 0.245).')
    }
    if (!Number.isFinite(daily) || daily < 0 || daily > 20) {
      throw new Error('Enter the daily charge in dollars (for example 2.10).')
    }
    if (rate === 0 && daily === 0) throw new Error('A power plan needs a rate or a daily charge.')
    variableRate = round2(rate)
    dailyCharge = round2(daily)
  } else {
    const monthly = Number(input.monthlyPrice)
    if (!Number.isFinite(monthly) || monthly <= 0 || monthly > 2000) {
      throw new Error('Enter the monthly price in dollars.')
    }
    monthlyPrice = round2(monthly)
  }

  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO deal_plans
         (category, provider, plan_name, monthly_price, variable_rate, daily_charge, region, source_url, verified_at, stale, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)
       ON CONFLICT(category, provider, plan_name) DO UPDATE SET
         monthly_price = excluded.monthly_price,
         variable_rate = excluded.variable_rate,
         daily_charge = excluded.daily_charge,
         region = excluded.region,
         source_url = excluded.source_url,
         verified_at = excluded.verified_at,
         stale = 0,
         notes = excluded.notes,
         active = 1`
    )
    .run(
      category,
      provider,
      planName,
      monthlyPrice,
      variableRate,
      dailyCharge,
      (input.region ?? '').trim() || null,
      validUrl(input.sourceUrl),
      now,
      (input.notes ?? '').trim() || null
    )

  return getDealsReport()
}

export function deleteDealPlan(id: number): DealsReport {
  getDb().prepare('DELETE FROM deal_plans WHERE id = ?').run(id)
  return getDealsReport()
}

export function setPowerUsage(kwh: number): DealsReport {
  if (!Number.isFinite(kwh) || kwh < USAGE_MIN || kwh > USAGE_MAX) {
    throw new Error(`Monthly usage must be between ${USAGE_MIN} and ${USAGE_MAX} kWh.`)
  }
  setSetting(USAGE_KEY, String(round2(kwh)))
  return getDealsReport()
}

// ------------------------------------------------------------- renewal nudge

/**
 * One Discord nudge per policy per renewal date, inside the last week before
 * it renews. Insurance can't be price-compared automatically, so the message
 * asks for a manual review rather than pretending otherwise.
 */
export async function notifyInsuranceReviews(): Promise<number> {
  const today = todayLocalIso()
  const due = listPolicies().filter((p) => p.renewalDate && needsRenewalReview(today, p.renewalDate, 7))
  if (due.length === 0) return 0

  const db = getDb()
  const already = db.prepare('SELECT 1 AS x FROM notified_alerts WHERE alert_key = ?')
  const mark = db.prepare('INSERT OR IGNORE INTO notified_alerts (alert_key, sent_at) VALUES (?, ?)')
  const fresh = due.filter((p) => !already.get(`insurance-review:${p.id}:${p.renewalDate}`))
  if (fresh.length === 0) return 0

  const lines = fresh
    .map((p) => {
      const name = p.provider ?? p.coverType ?? 'Insurance policy'
      const cover = p.coverType && p.coverType !== name ? ` (${p.coverType})` : ''
      const premium = p.premium != null ? ` · $${p.premium.toFixed(2)} ${p.frequency ?? ''}`.trimEnd() : ''
      const days = daysBetweenIso(today, p.renewalDate as string)
      const when = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`
      return `• **${name}**${cover} renews ${when} (${p.renewalDate})${premium}`
    })
    .join('\n')

  try {
    const r = await sendDiscordMessage(
      `🛡️ **Insurance renewal review**\n${lines}\n\nPremiums are priced on your own details, so this one needs a manual review. Check the cover and compare before it auto-renews.`
    )
    if (r.ok) {
      for (const p of fresh) mark.run(`insurance-review:${p.id}:${p.renewalDate}`, Date.now())
      return fresh.length
    }
    return 0
  } catch {
    // No webhook configured, or Discord is down — the Deals screen still lists it.
    return 0
  }
}

// ------------------------------------------------------------------ scheduler

/** Refresh prices weekly. Failures land in Settings → Service health. */
export function startDealScheduler(): NodeJS.Timeout {
  const run = async (): Promise<void> => {
    await track('deals', async () => {
      seedDeals()
      const previous = lastRefreshAt()
      if (previous && Date.now() - previous < REFRESH_MS) return true
      await refreshDealPrices()
      return true
    })
  }
  setTimeout(run, 45_000)
  return setInterval(run, 12 * 60 * 60 * 1000)
}

/** The comparison link for each category, opened in the user's browser. */
export function compareLink(category: DealCategory): { label: string; url: string } {
  return COMPARE_LINKS[category]
}
