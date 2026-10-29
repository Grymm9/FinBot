import { getDb } from '../db'
import { REAL_TX } from './filters'
import { computeBudgetStatus, matchCategory } from './budget'
import { currentCycleRange, recentCycleRanges } from './cycle'
import { addDaysIso, localIsoDate, parseLocalDate, todayLocalIso } from './dates'
import { classifyCadence, displayName, merchantKey } from './subscriptions'
import { daysBetween, daysIn, daysInto, round2 } from './reconcile-math'
import { annualIncrease, daysExhaustedEarly, isPriceIncrease, percentAbove, velocityExceeds } from './ai-alert-math'
import type { AiAlert, AiAlertFeed, AiAlertKind } from '@shared/types'

/**
 * AI insight alerts for the Dashboard panel.
 *
 * Two background checks run alongside the normal alert scheduler:
 *
 *   1. Subscription creep — a recurring charge (including utilities and fixed
 *      bills, which the subscription screen deliberately excludes) rises above
 *      its prior baseline. Suppressed when the matching budget category was
 *      manually edited after the hike, because the user has already responded.
 *
 *   2. Spending velocity — a category's spend-to-date is at least 25% above the
 *      three-month rolling average for the same day of the cycle.
 *
 * Alerts are persisted in `ai_alerts`, deduped by a stable key, and carry their
 * own read/dismissed state so the badge is an actionable unread count.
 */

const TX_LOOKBACK_DAYS = 400
const RISE_WINDOW_DAYS = 45
const VELOCITY_THRESHOLD = 25
const VELOCITY_MIN_BASELINE = 5
const MAX_VELOCITY_ALERTS = 8

interface TxRow {
  id: string
  date: string
  description: string
  amount: number
  merchant: string | null
  category: string | null
}

interface DetectedAlert {
  dedupeKey: string
  kind: AiAlertKind
  severity: AiAlert['severity']
  title: string
  body: string
  merchant: string | null
  category: string | null
  amount: number | null
  previousAmount: number | null
  cycleStart: string | null
}

interface AlertRow {
  id: number
  dedupe_key: string
  kind: string
  severity: string
  title: string
  body: string
  merchant: string | null
  category: string | null
  amount: number | null
  previous_amount: number | null
  cycle_start: string | null
  created_at: number
  updated_at: number
  read_at: number | null
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function dollars(n: number): string {
  return `$${n.toFixed(2)}`
}

/** Match the budget category on the description first, then the merchant text. */
function chargeCategory(description: string, merchant: string | null, akahu: string | null): string | null {
  return matchCategory(description, merchant, akahu) ?? (merchant ? matchCategory(merchant, null, akahu) : null)
}

/** Transactions and labels that are budget plumbing rather than real spending. */
function plumbingExclusions(): { txIds: Set<string>; labels: string[] } {
  const db = getDb()
  const txIds = new Set<string>()
  for (const r of db.prepare('SELECT transaction_id AS id FROM payment_matches').all() as Array<{ id: string }>) {
    txIds.add(r.id)
  }
  const labels = (
    [
      ...(db
        .prepare('SELECT transfer_label AS l FROM budget_group_destinations WHERE transfer_label IS NOT NULL')
        .all() as Array<{ l: string }>),
      ...(db
        .prepare('SELECT transfer_label AS l FROM category_destinations WHERE transfer_label IS NOT NULL')
        .all() as Array<{ l: string }>),
      ...(db.prepare('SELECT transfer_label AS l FROM budget_groups WHERE transfer_label IS NOT NULL').all() as Array<{
        l: string
      }>)
    ] as Array<{ l: string }>
  )
    .map((r) => r.l.toLowerCase().trim())
    .filter((l) => l.length >= 3)
  return { txIds, labels }
}

/** True when the category allocation was edited after the charge date. */
function budgetRespondedAfter(category: string | null, chargeDate: string): boolean {
  if (!category) return false
  const row = getDb().prepare('SELECT updated_at FROM categories WHERE name = ?').get(category) as
    | { updated_at: number | null }
    | undefined
  if (!row?.updated_at) return false
  return row.updated_at >= parseLocalDate(chargeDate).getTime()
}

function detectSubscriptionIncreases(today: string): DetectedAlert[] {
  const db = getDb()
  const since = localIsoDate(new Date(Date.now() - TX_LOOKBACK_DAYS * 86400000))
  const { txIds, labels } = plumbingExclusions()

  const rows = db
    .prepare(
      `SELECT id, date, description, amount, merchant, category FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ?
       ORDER BY date ASC`
    )
    .all(since) as TxRow[]

  const groups = new Map<
    string,
    { name: string; charges: Array<{ date: string; amount: number; category: string | null }> }
  >()

  for (const r of rows) {
    if (txIds.has(r.id)) continue
    const description = r.description.toLowerCase()
    if (/\btfr\s+(?:to|from)\b/.test(description)) continue
    if (labels.some((l) => description.includes(l))) continue

    const key = merchantKey(r.merchant, r.description)
    if (!key || key.length < 3) continue

    const category = chargeCategory(r.description, r.merchant, r.category)
    const group = groups.get(key) ?? { name: displayName(r.merchant, r.description), charges: [] }
    group.charges.push({ date: r.date, amount: Math.abs(r.amount), category })
    groups.set(key, group)
  }

  const out: DetectedAlert[] = []

  for (const [key, group] of groups) {
    if (group.charges.length < 3) continue

    const charges = [...group.charges].sort((a, b) => a.date.localeCompare(b.date))
    const latest = charges[charges.length - 1]
    const daysSince = daysBetween(latest.date, today)
    if (daysSince < 0 || daysSince > RISE_WINDOW_DAYS) continue

    const gaps: number[] = []
    for (let i = 1; i < charges.length; i++) gaps.push(daysBetween(charges[i - 1].date, charges[i].date))
    const cadence = classifyCadence(median(gaps))
    if (!cadence) continue

    const amounts = charges.map((c) => c.amount)
    const priorAmounts = amounts.slice(0, -1)
    if (priorAmounts.length < 2) continue
    const priorMedian = round2(median(priorAmounts))
    const stable = priorAmounts.every((a) => Math.abs(a - priorMedian) <= Math.max(1.5, priorMedian * 0.08))
    if (!stable || !isPriceIncrease(latest.amount, priorMedian)) continue
    if (budgetRespondedAfter(latest.category, latest.date)) continue

    const extra = annualIncrease(latest.amount, priorMedian, cadence)
    const risePercent = percentAbove(latest.amount, priorMedian)
    out.push({
      dedupeKey: `sub-inc:${key}:${latest.date}`,
      kind: 'subscription_increase',
      severity: risePercent >= 10 ? 'bad' : 'warn',
      title: 'Subscription Price Increase Detected',
      body: `Notice: ${group.name} charged ${dollars(latest.amount)} (previously ${dollars(
        priorMedian
      )}). This adds ${dollars(extra)} to your yearly recurring baseline.`,
      merchant: group.name,
      category: latest.category,
      amount: round2(latest.amount),
      previousAmount: priorMedian,
      cycleStart: null
    })
  }

  return out
}

function detectSpendingVelocity(today: string): DetectedAlert[] {
  const cycles = recentCycleRanges(4)
  if (cycles.length < 4) return []

  const current = cycles[cycles.length - 1]
  const prior = cycles.slice(0, -1)
  const totalDays = daysIn(current.start, current.end)
  const dayNumber = Math.min(totalDays, daysInto(current.start, today))

  const currentEnd = addDaysIso(today, 1)
  const currentStatus = computeBudgetStatus(
    current.start,
    currentEnd < current.end ? currentEnd : current.end
  )

  // Spend-to-the-same-cycle-day for each of the previous three cycles.
  const priorSpend: Array<Map<string, number>> = prior.map((cycle) => {
    const cap = addDaysIso(cycle.start, dayNumber)
    const end = cap < cycle.end ? cap : cycle.end
    return new Map(computeBudgetStatus(cycle.start, end).map((s) => [s.category, s.spent]))
  })

  const out: DetectedAlert[] = []

  for (const status of currentStatus) {
    if (status.budgeted <= 0 || status.spent <= 0) continue

    const samples = priorSpend.map((m) => m.get(status.category) ?? 0)
    // Require real history: at least two of the three prior cycles. Otherwise a
    // brand-new category looks infinitely accelerated against empty months.
    if (samples.filter((s) => s > 0).length < 2) continue

    const baseline = round2(samples.reduce((sum, s) => sum + s, 0) / samples.length)
    if (baseline < VELOCITY_MIN_BASELINE || !velocityExceeds(status.spent, baseline, VELOCITY_THRESHOLD)) {
      continue
    }

    const percent = Math.round(percentAbove(status.spent, baseline))
    const early = daysExhaustedEarly(status.spent, status.budgeted, dayNumber, totalDays)
    out.push({
      dedupeKey: `velocity:${current.start}:${status.category}`,
      kind: 'spending_velocity',
      severity: percent >= 75 ? 'bad' : 'warn',
      title: 'Spending Acceleration Alert',
      body: `${status.category} spending is tracking ${percent}% higher than your average for Day ${dayNumber} of your cycle. At this pace, allocation will be exhausted ${early} days early.`,
      merchant: null,
      category: status.category,
      amount: round2(status.spent),
      previousAmount: baseline,
      cycleStart: current.start
    })
  }

  return out.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, MAX_VELOCITY_ALERTS)
}

/** Run both checks and upsert the results. */
export function refreshAiAlerts(): AiAlertFeed {
  const db = getDb()
  const today = todayLocalIso()
  const current = currentCycleRange()
  const detected = [...detectSubscriptionIncreases(today), ...detectSpendingVelocity(today)]

  const upsert = db.prepare(
    `INSERT INTO ai_alerts
       (dedupe_key, kind, severity, title, body, merchant, category, amount, previous_amount, cycle_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       severity = excluded.severity,
       title = excluded.title,
       body = excluded.body,
       amount = excluded.amount,
       previous_amount = excluded.previous_amount,
       updated_at = excluded.updated_at`
  )

  const now = Date.now()
  const tx = db.transaction(() => {
    // Velocity alerts only make sense for the cycle they describe. Drop old
    // ones so the unread badge never fills with last month's news.
    db.prepare("DELETE FROM ai_alerts WHERE kind = 'spending_velocity' AND cycle_start IS NOT NULL AND cycle_start <> ?").run(
      current.start
    )
    for (const a of detected) {
      upsert.run(
        a.dedupeKey,
        a.kind,
        a.severity,
        a.title,
        a.body,
        a.merchant,
        a.category,
        a.amount,
        a.previousAmount,
        a.cycleStart,
        now,
        now
      )
    }

    // A price-rise alert disappears once the user has updated the matching
    // budget line (or the charge is no longer in the detection window).
    const subKeys = detected.filter((a) => a.kind === 'subscription_increase').map((a) => a.dedupeKey)
    if (subKeys.length === 0) {
      db.prepare(
        "UPDATE ai_alerts SET dismissed_at = ?, read_at = COALESCE(read_at, ?) WHERE kind = 'subscription_increase' AND dismissed_at IS NULL"
      ).run(now, now)
    } else {
      db.prepare(
        `UPDATE ai_alerts SET dismissed_at = ?, read_at = COALESCE(read_at, ?)
         WHERE kind = 'subscription_increase' AND dismissed_at IS NULL
           AND dedupe_key NOT IN (${subKeys.map(() => '?').join(',')})`
      ).run(now, now, ...subKeys)
    }
  })
  tx()

  return getAiAlertFeed()
}

function mapRow(r: AlertRow): AiAlert {
  return {
    id: r.id,
    kind: r.kind === 'spending_velocity' ? 'spending_velocity' : 'subscription_increase',
    severity: r.severity === 'bad' || r.severity === 'info' ? r.severity : 'warn',
    title: r.title,
    body: r.body,
    merchant: r.merchant,
    category: r.category,
    amount: r.amount,
    previousAmount: r.previous_amount,
    cycleStart: r.cycle_start,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    readAt: r.read_at
  }
}

export function listAiAlerts(limit = 50): AiAlert[] {
  const rows = getDb()
    .prepare(
      `SELECT id, dedupe_key, kind, severity, title, body, merchant, category, amount, previous_amount,
              cycle_start, created_at, updated_at, read_at
       FROM ai_alerts
       WHERE dismissed_at IS NULL
       ORDER BY (read_at IS NULL) DESC, created_at DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as AlertRow[]
  return rows.map(mapRow)
}

export function unreadAiAlertCount(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM ai_alerts WHERE dismissed_at IS NULL AND read_at IS NULL')
    .get() as { c: number }
  return row.c
}

export function getAiAlertFeed(): AiAlertFeed {
  return { alerts: listAiAlerts(), unread: unreadAiAlertCount() }
}

export function markAiAlertRead(id: number): AiAlertFeed {
  getDb()
    .prepare('UPDATE ai_alerts SET read_at = COALESCE(read_at, ?) WHERE id = ?')
    .run(Date.now(), id)
  return getAiAlertFeed()
}

export function dismissAiAlert(id: number): AiAlertFeed {
  const now = Date.now()
  getDb()
    .prepare('UPDATE ai_alerts SET dismissed_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?')
    .run(now, now, id)
  return getAiAlertFeed()
}
