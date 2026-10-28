import { getDb } from '../db'
import { persistCycleHistory, listCycleHistory, topCategoryVariance } from './history'
import { REAL_TX } from './filters'
import { todayLocalIso, parseLocalDate } from './dates'
import { listSubscriptions, subscriptionMonthlyTotal } from './subscriptions'
import { money } from './forecast-math'
import type { CycleReview } from '@shared/types'

/**
 * Cycle reviews: a short, written summary of a closed pay cycle.
 *
 * `cycle_history` and `budget_history` have been persisted for a while but
 * nothing ever read them back to a human. This turns each closed cycle into a
 * few sentences — the biggest variance, new merchants, subscription load, and
 * savings rate — and is completely deterministic (no model call, no cost).
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/^card\s+\d{3,4}\s*/i, '')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface MerchantRow {
  description: string
  merchant: string | null
  amount: number
}

/** Merchants seen this cycle that had never appeared in the 180 days before it. */
function newMerchants(cycleStart: string, cycleEnd: string, limit = 4): string[] {
  const db = getDb()
  const since = new Date(parseLocalDate(cycleStart).getTime() - 180 * 86400000)
  const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(
    since.getDate()
  ).padStart(2, '0')}`

  const prior = new Set(
    (
      db
        .prepare(
          `SELECT description, merchant FROM transactions
           WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?`
        )
        .all(sinceIso, cycleStart) as MerchantRow[]
    ).map((r) => normalise(r.merchant ?? r.description))
  )

  const rows = db
    .prepare(
      `SELECT description, merchant, amount FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?
       ORDER BY amount ASC`
    )
    .all(cycleStart, cycleEnd) as MerchantRow[]

  const fresh = new Map<string, { label: string; amount: number }>()
  for (const r of rows) {
    const key = normalise(r.merchant ?? r.description)
    if (!key || key.length < 3 || prior.has(key)) continue
    const label = merchantLabel(r)
    const existing = fresh.get(key)
    if (existing) existing.amount += Math.abs(r.amount)
    else fresh.set(key, { label, amount: Math.abs(r.amount) })
  }

  return [...fresh.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((m) => m.label)
}

/**
 * A display label for a merchant. Bank descriptions carry exchange-rate noise
 * ("AUD 544.39 QANTAS AIR081239417830at 0.8041*"), which is unreadable in a
 * review, so strip the FX wrapper, card prefix and trailing rate markers.
 */
function merchantLabel(row: MerchantRow): string {
  const raw = (row.merchant ?? row.description ?? '').trim()
  const cleaned = raw
    .replace(/^(AUD|USD|EUR|GBP|CAD|JPY)\s+[\d.,]+\s+/i, '')
    .replace(/^CARD\s+\d{3,4}\s+/i, '')
    .replace(/^(EFTPOS|VISA|MC)\s+/i, '')
    .replace(/^(TFR|MB TRANSFER|FN TRANSFER|PM TRANSFER|TRANSFER)\s+(TO|FROM|EX)\s+/i, '')
    .replace(/^LOAN REPAYMENT\s+/i, '')
    .replace(/\b\d{2}-\d{4}-\d{7}-\d{2}\b/g, ' ')
    .replace(/\s*at\s+[\d.,]+\*/i, '')
    .replace(/[0-9]{6,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length >= 3 ? cleaned : raw
}

export function generateReview(cycleStart: string): CycleReview | null {
  const history = listCycleHistory(12)
  const cycle = history.find((c) => c.cycleStart === cycleStart)
  if (!cycle) return null

  const previous = history.find((c) => c.cycleStart < cycleStart)
  // Only real budgeted categories are useful in a review: "Uncategorised" is
  // not a budget line and a category with no budget can't be over one.
  const variance = topCategoryVariance(cycleStart, 8).filter(
    (v) => v.budgeted > 0 && v.category.toLowerCase() !== 'uncategorised'
  )
  const merchants = newMerchants(cycleStart, cycle.cycleEnd)
  const subs = listSubscriptions()
  const subsMonthly = subscriptionMonthlyTotal(subs)

  const savingsRate = cycle.income > 0 ? cycle.net / cycle.income : 0
  const netVsPrev = previous ? round2(cycle.net - previous.net) : null

  const lines: string[] = []
  lines.push(`Spent ${money(cycle.expense)} against ${money(cycle.income)} of income.`)

  if (previous) {
    const direction = netVsPrev !== null && netVsPrev >= 0 ? 'better than' : 'worse than'
    const amount = Math.abs(netVsPrev ?? 0)
    lines.push(`Net ${money(cycle.net)} — ${money(amount)} ${direction} the ${previous.label} cycle.`)
  } else {
    lines.push(`Net ${money(cycle.net)}.`)
  }

  const over = variance.filter((v) => v.variance > 0).slice(0, 3)
  if (over.length > 0) {
    lines.push(
      `Biggest overspends: ${over
        .map((v) => `${v.category} ${money(v.variance)} over`)
        .join(', ')}.`
    )
  } else if (variance.length > 0) {
    lines.push(`Every tracked category stayed inside its budget.`)
  }

  if (merchants.length > 0) {
    lines.push(`New merchants: ${merchants.join(', ')}.`)
  }

  if (subs.length > 0) {
    lines.push(`Subscriptions: ${money(subsMonthly)}/month across ${subs.length} service${subs.length === 1 ? '' : 's'}.`)
  }

  let headline: string
  if (cycle.income > 0 && cycle.net > 0) {
    headline = `Kept ${Math.round(savingsRate * 100)}% of income — ${money(cycle.net)} ahead.`
  } else if (cycle.net < 0) {
    headline = `Spent ${money(Math.abs(cycle.net))} more than came in.`
  } else {
    headline = `Broke even — ${money(cycle.income)} in, ${money(cycle.expense)} out.`
  }

  const metrics: Record<string, number> = {
    income: cycle.income,
    expense: cycle.expense,
    net: cycle.net,
    savingsRate: round2(savingsRate * 100),
    subscriptionsMonthly: subsMonthly
  }

  const review: CycleReview = {
    cycleStart,
    label: cycle.label,
    headline,
    body: lines.join('\n'),
    metrics,
    createdAt: Date.now()
  }

  getDb()
    .prepare(
      `INSERT INTO reviews (cycle_start, label, headline, body, metrics, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cycle_start) DO UPDATE SET
         label = excluded.label,
         headline = excluded.headline,
         body = excluded.body,
         metrics = excluded.metrics`
    )
    .run(cycleStart, review.label, review.headline, review.body, JSON.stringify(metrics), review.createdAt)

  return review
}

/**
 * Ensure every closed cycle in the lookback window has a review.
 * Returns only the reviews created by this call (used for the Discord post).
 */
export function refreshReviews(lookback = 6): CycleReview[] {
  persistCycleHistory(lookback)
  const today = todayLocalIso()
  const existing = new Set(
    (getDb().prepare('SELECT cycle_start FROM reviews').all() as Array<{ cycle_start: string }>).map(
      (r) => r.cycle_start
    )
  )

  const created: CycleReview[] = []
  for (const cycle of listCycleHistory(lookback)) {
    if (cycle.cycleEnd > today) continue // not finished
    if (existing.has(cycle.cycleStart)) continue
    const review = generateReview(cycle.cycleStart)
    if (review) created.push(review)
  }
  return created
}

export function listReviews(limit = 6): CycleReview[] {
  const rows = getDb()
    .prepare(
      `SELECT cycle_start, label, headline, body, metrics, created_at
       FROM reviews ORDER BY cycle_start DESC LIMIT ?`
    )
    .all(limit) as Array<{
    cycle_start: string
    label: string | null
    headline: string
    body: string
    metrics: string | null
    created_at: number | null
  }>

  return rows.map((r) => ({
    cycleStart: r.cycle_start,
    label: r.label ?? r.cycle_start,
    headline: r.headline,
    body: r.body,
    metrics: safeMetrics(r.metrics),
    createdAt: r.created_at ?? 0
  }))
}

export function latestReview(): CycleReview | null {
  return listReviews(1)[0] ?? null
}

function safeMetrics(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}
