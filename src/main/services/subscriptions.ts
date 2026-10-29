import { getDb } from '../db'
import { REAL_TX } from './filters'
import { matchCategory } from './budget'
import { daysBetween, round2 } from './reconcile-math'
import { localIsoDate } from './dates'
import type { Subscription } from '@shared/types'

/**
 * Recurring-charge (subscription) detection.
 *
 * Deliberately excludes anything that is part of the budget plumbing, so a
 * standing order that funds an envelope is never reported as a subscription:
 *   - internal transfers / paired envelope transfers are already removed by REAL_TX
 *   - any transaction manually matched to a budget destination (payment_matches)
 *   - any TFR TO / TFR FROM transfer (budget funding), however it is prefixed
 *   - any category routed to a destination in the budget
 *   - any transaction linked to an insurance policy or bundle
 *   - insurance / rent / rates / utilities style commitment categories
 *   - any description matching a destination's transfer label
 *
 * Group *items* are not excluded wholesale: a discretionary category such as
 * "Spending Money" can still contain genuine subscriptions (e.g. Netflix).
 */

const COMMITMENT_CATEGORY =
  /\b(rent|mortgage|loan|insurance|rates|power|electric|electricity|water|internet|broadband|council|local government)\b/i

export interface DetectedCharge {
  key: string
  merchant: string
  amount: number
  previousAmount: number | null
  cadence: string
  monthlyAmount: number
  lastDate: string
  occurrences: number
  confidence: number
  priceRose: boolean
}

interface TxRow {
  id: string
  date: string
  description: string
  amount: number
  merchant: string | null
  category: string | null
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function merchantKey(merchant: string | null, description: string): string {
  const base = (merchant ?? '').trim() || description.replace(/^card\s+\d{3,4}\s*/i, '')
  return base
    .toLowerCase()
    .replace(/\d{3,}/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function displayName(merchant: string | null, description: string): string {
  if (merchant && merchant.trim()) return merchant.trim()
  return description.replace(/^card\s+\d{3,4}\s*/i, '').replace(/\s+/g, ' ').trim()
}

/** Map a median gap in days onto a cadence label, or null if irregular. */
export function classifyCadence(gap: number): string | null {
  if (gap >= 5 && gap <= 9) return 'weekly'
  if (gap >= 12 && gap <= 16) return 'fortnightly'
  if (gap >= 26 && gap <= 34) return 'monthly'
  if (gap >= 80 && gap <= 100) return 'quarterly'
  if (gap >= 350 && gap <= 380) return 'yearly'
  return null
}

/** Build the set of transaction ids and descriptions that belong to the budget. */
function budgetExclusions(): {
  txIds: Set<string>
  categories: Set<string>
  labels: string[]
} {
  const db = getDb()
  const txIds = new Set<string>()

  for (const r of db.prepare('SELECT transaction_id AS id FROM payment_matches').all() as Array<{ id: string }>) {
    txIds.add(r.id)
  }
  for (const r of db
    .prepare('SELECT linked_transaction_id AS id FROM insurance_policies WHERE linked_transaction_id IS NOT NULL')
    .all() as Array<{ id: string }>) {
    txIds.add(r.id)
  }
  for (const r of db
    .prepare('SELECT linked_transaction_id AS id FROM insurance_bundles WHERE linked_transaction_id IS NOT NULL')
    .all() as Array<{ id: string }>) {
    txIds.add(r.id)
  }

  const categories = new Set<string>()
  for (const r of db.prepare('SELECT DISTINCT category FROM category_destinations').all() as Array<{
    category: string
  }>) {
    categories.add(r.category)
  }

  const labels = (
    [
      ...(db.prepare('SELECT transfer_label AS l FROM budget_group_destinations WHERE transfer_label IS NOT NULL').all() as Array<{ l: string }>),
      ...(db.prepare('SELECT transfer_label AS l FROM category_destinations WHERE transfer_label IS NOT NULL').all() as Array<{ l: string }>),
      ...(db.prepare('SELECT transfer_label AS l FROM budget_groups WHERE transfer_label IS NOT NULL').all() as Array<{ l: string }>)
    ] as Array<{ l: string }>
  )
    .map((r) => r.l.toLowerCase().trim())
    .filter((l) => l.length >= 3)

  return { txIds, categories, labels }
}

/** Detect recurring charges from the last `days` of real spending. */
export function detectSubscriptions(days = 400): DetectedCharge[] {
  const db = getDb()
  const since = localIsoDate(new Date(Date.now() - days * 86400000))
  const { txIds, categories, labels } = budgetExclusions()

  const rows = db
    .prepare(
      `SELECT id, date, description, amount, merchant, category FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ?
       ORDER BY date ASC`
    )
    .all(since) as TxRow[]

  const groups = new Map<string, { name: string; charges: Array<{ date: string; amount: number }> }>()

  for (const r of rows) {
    if (txIds.has(r.id)) continue

    const category = matchCategory(r.description, r.merchant, r.category)
    const label = category ?? r.category
    if (label && (categories.has(label) || COMMITMENT_CATEGORY.test(label))) continue

    const description = r.description.toLowerCase()
    if (/\btfr\s+(?:to|from)\b/.test(description)) continue
    if (labels.some((l) => description.includes(l))) continue

    const key = merchantKey(r.merchant, r.description)
    if (!key || key.length < 3) continue

    const g = groups.get(key) ?? { name: displayName(r.merchant, r.description), charges: [] }
    g.charges.push({ date: r.date, amount: Math.abs(r.amount) })
    groups.set(key, g)
  }

  const out: DetectedCharge[] = []

  for (const [key, g] of groups) {
    if (g.charges.length < 3) continue

    const charges = [...g.charges].sort((a, b) => a.date.localeCompare(b.date))
    const span = daysBetween(charges[0].date, charges[charges.length - 1].date)
    if (span < 10) continue

    const gaps: number[] = []
    for (let i = 1; i < charges.length; i++) gaps.push(daysBetween(charges[i - 1].date, charges[i].date))
    const gap = median(gaps)
    const cadence = classifyCadence(gap)
    if (!cadence) continue

    const amounts = charges.map((c) => c.amount)
    const amount = round2(median(amounts))
    if (amount <= 0) continue

    const tolerance = Math.max(1.5, amount * 0.08)
    const last = charges[charges.length - 1].amount
    const priorAmounts = amounts.slice(0, -1)
    const priorMedian = round2(median(priorAmounts))

    const allStable = amounts.every((a) => Math.abs(a - amount) <= tolerance)
    // A single price rise on the most recent charge still counts as a
    // subscription, but everything before it must have been stable.
    const roseOnlyAtEnd =
      priorAmounts.length >= 2 &&
      priorAmounts.every((a) => Math.abs(a - priorMedian) <= Math.max(1.5, priorMedian * 0.08)) &&
      last - priorMedian >= Math.max(1, priorMedian * 0.05)
    const priceRose = !allStable && roseOnlyAtEnd
    if (!allStable && !roseOnlyAtEnd) continue

    const monthlyAmount = round2((amount * (365.25 / 12)) / gap)
    const stability = allStable ? 1 : 0.7
    const confidence = round2(Math.min(1, 0.45 + charges.length * 0.06 + stability * 0.15))

    out.push({
      key,
      merchant: g.name,
      amount: priceRose ? round2(last) : amount,
      previousAmount: priceRose ? priorMedian : null,
      cadence,
      monthlyAmount: priceRose ? round2((last * (365.25 / 12)) / gap) : monthlyAmount,
      lastDate: charges[charges.length - 1].date,
      occurrences: charges.length,
      confidence,
      priceRose
    })
  }

  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function ignoredSubscriptionKeys(): Set<string> {
  const rows = getDb().prepare('SELECT merchant_key FROM subscription_ignores').all() as Array<{
    merchant_key: string
  }>
  return new Set(rows.map((r) => r.merchant_key))
}

export function ignoreSubscription(key: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO subscription_ignores (merchant_key, created_at) VALUES (?, ?)')
    .run(key, Date.now())
  getDb().prepare('DELETE FROM subscriptions WHERE key = ?').run(key)
}

export function unignoreSubscription(key: string): void {
  getDb().prepare('DELETE FROM subscription_ignores WHERE merchant_key = ?').run(key)
}

/** Re-run detection and replace the stored subscription list. */
export function refreshSubscriptions(): Subscription[] {
  const db = getDb()
  const ignored = ignoredSubscriptionKeys()
  const detected = detectSubscriptions()

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM subscriptions').run()
    const ins = db.prepare(
      `INSERT INTO subscriptions (key, merchant, amount, previous_amount, cadence, monthly_amount, last_date, occurrences, confidence, price_rose, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    for (const d of detected) {
      if (ignored.has(d.key)) continue
      ins.run(
        d.key,
        d.merchant,
        d.amount,
        d.previousAmount,
        d.cadence,
        d.monthlyAmount,
        d.lastDate,
        d.occurrences,
        d.confidence,
        d.priceRose ? 1 : 0
      )
    }
  })
  tx()

  return listSubscriptions()
}

export function listSubscriptions(): Subscription[] {
  const db = getDb()
  const cols = (db.prepare('PRAGMA table_info(subscriptions)').all() as Array<{ name: string }>).map((c) => c.name)
  const previousExpr = cols.includes('previous_amount') ? 'previous_amount' : 'NULL'
  const roseExpr = cols.includes('price_rose') ? 'price_rose' : '0'
  const keyExpr = cols.includes('key') ? 'key' : 'LOWER(merchant)'

  const rows = db
    .prepare(
      `SELECT id, ${keyExpr} AS key, merchant, amount, ${previousExpr} AS previous_amount, cadence,
              monthly_amount, last_date, occurrences, confidence, ${roseExpr} AS price_rose
       FROM subscriptions ORDER BY monthly_amount DESC, merchant`
    )
    .all() as Array<{
    id: number
    key: string
    merchant: string
    amount: number
    previous_amount: number | null
    cadence: string
    monthly_amount: number
    last_date: string
    occurrences: number
    confidence: number
    price_rose: number
  }>

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    merchant: r.merchant,
    amount: r.amount,
    previousAmount: r.previous_amount,
    cadence: r.cadence,
    monthlyAmount: r.monthly_amount,
    lastDate: r.last_date,
    occurrences: r.occurrences,
    confidence: r.confidence,
    priceRose: r.price_rose === 1
  }))
}

export function subscriptionMonthlyTotal(subs = listSubscriptions()): number {
  return round2(subs.reduce((s, x) => s + x.monthlyAmount, 0))
}
