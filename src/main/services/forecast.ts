import { getDb } from '../db'
import { currentCycleRange } from './cycle'
import { todayLocalIso, parseLocalDate } from './dates'
import { listSubscriptions } from './subscriptions'
import { listCategories, computeBudgetStatus } from './budget'
import { listGroups, listCategoryDestinations } from './groups'
import { listCycleHistory } from './history'
import { REAL_TX, FUNDING_TX } from './filters'
import { getSettingNumber } from './settings'
import {
  buildForecast,
  daysBetweenIso,
  median,
  medianDayOfMonth,
  money,
  addDaysIso,
  nextOccurrence
} from './forecast-math'
import type { ForecastEvent, ForecastSummary } from '@shared/types'

/**
 * Cash-flow forecast from today to the next payday.
 *
 * Answers the question the app should answer without being asked: *will I make
 * it to payday, and where does the balance dip?* Everything is deterministic —
 * no AI involved. Inputs:
 *
 *   - live balances (enabled accounts only)
 *   - routed destination transfers that haven't been seen yet this cycle
 *   - detected subscriptions due before payday (cadence-anchored)
 *   - discretionary budget left, spread evenly over the remaining days
 *   - estimated payday income (median of recent closed cycles)
 */

interface Cycle {
  start: string
  end: string
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function startBalance(): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(b.current), 0) AS v
       FROM balances b JOIN accounts a ON a.id = b.account_id
       WHERE a.enabled = 1`
    )
    .get() as { v: number }
  return round2(row.v)
}

/**
 * Whether a transfer of roughly `amount` already left an account this cycle.
 * Budget funding transfers move between the user's own accounts, so this is how
 * we avoid forecasting a payment that has already been made.
 */
function hasCycleDebit(amount: number, cycle: Cycle, toleranceRatio = 0.05): boolean {
  if (amount <= 0) return false
  const tol = Math.max(5, amount * toleranceRatio)
  return !!getDb()
    .prepare(
      `SELECT 1 AS x FROM transactions
       WHERE ${FUNDING_TX} AND amount < 0 AND ABS(ABS(amount) - ?) <= ? AND date >= ? AND date < ? LIMIT 1`
    )
    .get(amount, tol, cycle.start, cycle.end)
}

function manualMatch(destinationId: number, kind: 'group' | 'category', cycle: Cycle): boolean {
  return !!getDb()
    .prepare('SELECT 1 AS x FROM payment_matches WHERE destination_id = ? AND kind = ? AND cycle_start = ?')
    .get(destinationId, kind, cycle.start)
}

interface HistoryHint {
  /** Typical day-of-month the payment lands on, if we have history. */
  day: number | null
  /**
   * Amount of the most recent similar debit. Only set when the match was on the
   * transfer label: a coincidental amount match (e.g. a $239.46 fee) must not
   * be treated as proof that this payment was made.
   */
  amount: number | null
}

/**
 * Look up how this payment has actually been made before: the day it usually
 * lands and how much it usually is. Matches on the transfer label first, then
 * falls back to a similar amount purely for timing — the configured figures
 * drift (Rates went from $200 to $147.40) and the bank description rarely
 * matches the label exactly.
 */
function historyFor(label: string | null, configured: number, cycle: Cycle): HistoryHint {
  const db = getDb()
  const since = addDaysIso(cycle.start, -180)

  if (label && label.trim().length >= 3) {
    // Bank descriptions mangle transfer labels ("TFR TO Sharesies Nom DA855816"
    // vs the label "TFR TO Sharesies NomDA855816"), so compare without spaces.
    const needle = `%${label.replace(/[%_]/g, '').replace(/\s+/g, '')}%`
    const rows = db
      .prepare(
        `SELECT date, amount FROM transactions
         WHERE ${FUNDING_TX} AND amount < 0 AND date >= ? AND REPLACE(description, ' ', '') LIKE ?`
      )
      .all(since, needle) as Array<{ date: string; amount: number }>
    if (rows.length > 0) {
      const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
      return {
        day: medianDayOfMonth(rows.map((r) => r.date)),
        amount: round2(Math.abs(sorted[sorted.length - 1].amount))
      }
    }
  }

  if (configured <= 0) return { day: null, amount: null }
  const rows = db
    .prepare(
      `SELECT date FROM transactions
       WHERE ${FUNDING_TX} AND amount < 0 AND date >= ? AND ABS(ABS(amount) - ?) <= ?`
    )
    .all(since, configured, Math.max(5, configured * 0.1)) as Array<{ date: string }>
  return { day: medianDayOfMonth(rows.map((r) => r.date)), amount: null }
}

/** The date in the current month closest to the given day-of-month. */
function dateInMonth(monthIso: string, day: number): string {
  const d = parseLocalDate(monthIso)
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return `${month}-${String(Math.min(Math.max(1, day), lastDay)).padStart(2, '0')}`
}

/** Estimated payday income: median of the last three closed cycles. */
function estimatedIncome(): number {
  const today = todayLocalIso()
  const closed = listCycleHistory(6).filter((c) => c.cycleEnd <= today)
  const fromHistory = closed
    .slice(0, 3)
    .map((c) => c.income)
    .filter((n) => n > 0)
  if (fromHistory.length > 0) return round2(median(fromHistory))

  const db = getDb()
  const totals = closed.slice(0, 3).map((c) => {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS v FROM transactions
         WHERE ${REAL_TX} AND amount > 0 AND date >= ? AND date < ?`
      )
      .get(c.cycleStart, c.cycleEnd) as { v: number }
    return row.v
  })
  return round2(median(totals.filter((n) => n > 0)))
}

export function buildCashFlowForecast(): ForecastSummary {
  const cycle = currentCycleRange()
  const today = todayLocalIso()
  const endDate = cycle.end > today ? cycle.end : today
  const events: ForecastEvent[] = []

  const status = computeBudgetStatus(cycle.start, cycle.end)
  const byCategory = new Map(status.map((s) => [s.category, s]))
  /** A category that has already been spent down counts as settled for the cycle. */
  const settled = (category: string): boolean => {
    const s = byCategory.get(category)
    return !!s && s.budgeted > 0 && s.spent >= s.budgeted * 0.9
  }

  const routedCategories = new Set<string>()

  // ---------------------------------------------------------- committed payments
  for (const g of listGroups()) {
    for (const item of g.items) routedCategories.add(item.category)
    if (g.destinations.length === 0) continue

    const destAmounts = g.destinations
      .map((d) => d.amount)
      .filter((n): n is number => typeof n === 'number' && n > 0)
    const configuredTotal = round2(destAmounts.reduce((s, n) => s + n, 0)) || round2(g.sum)
    const groupLabel = g.destinations.find((d) => d.transferLabel)?.transferLabel ?? g.items.map((i) => i.category).join(' + ')
    const hint = historyFor(groupLabel, configuredTotal, cycle)

    // The user funds a group with one transfer (e.g. $964.66) even when the
    // destinations are configured as a split, so accept either the combined
    // total or every destination individually.
    const totalCandidates = [configuredTotal, round2(g.sum), hint.amount ?? 0].filter((n) => n > 0)
    const totalPaid = totalCandidates.some((a) => hasCycleDebit(a, cycle))
    const allDestinationsPaid = g.destinations.every(
      (d) => d.amount !== null && d.amount > 0 && hasCycleDebit(d.amount, cycle)
    )
    const settledBySpend = g.items.length > 0 && g.items.every((i) => settled(i.category))
    const paid =
      totalPaid ||
      allDestinationsPaid ||
      settledBySpend ||
      g.destinations.some((d) => manualMatch(d.id, 'group', cycle))

    if (paid) continue

    for (const d of g.destinations) {
      const amount = d.amount ?? configuredTotal
      if (amount <= 0) continue
      const day = d.transferLabel ? historyFor(d.transferLabel, amount, cycle).day : hint.day
      const date = day !== null ? dateInMonth(today, day) : addDaysIso(today, 3)
      events.push({
        date: clampToHorizon(date, today, endDate),
        label: d.transferLabel ?? groupLabel,
        amount: -round2(amount),
        kind: 'committed',
        estimated: day === null
      })
    }
  }

  const categories = listCategories()
  for (const r of listCategoryDestinations()) {
    routedCategories.add(r.category)
    const categoryAmount = categories.find((c) => c.name === r.category)?.amount ?? 0
    for (const d of r.destinations) {
      const amount = d.amount ?? categoryAmount
      if (amount <= 0) continue
      const hint = historyFor(d.transferLabel, amount, cycle)
      const paid =
        settled(r.category) || hasCycleDebit(amount, cycle) || manualMatch(d.id, 'category', cycle)
      if (paid) continue
      const date = hint.day !== null ? dateInMonth(today, hint.day) : addDaysIso(today, 3)
      events.push({
        date: clampToHorizon(date, today, endDate),
        label: d.transferLabel ?? r.category,
        amount: -round2(amount),
        kind: 'committed',
        estimated: hint.day === null
      })
    }
  }

  // -------------------------------------------------------------- subscriptions
  let subscriptionTotal = 0
  for (const sub of listSubscriptions()) {
    if (sub.amount <= 0) continue
    let next = nextOccurrence(sub.lastDate, sub.cadence, today)
    for (let i = 0; i < 6 && next <= endDate; i++) {
      if (next > today) {
        events.push({
          date: next,
          label: sub.merchant,
          amount: -round2(sub.amount),
          kind: 'subscription'
        })
        subscriptionTotal += sub.amount
      }
      next = nextOccurrence(next, sub.cadence, addDaysIso(next, 1))
    }
  }

  // -------------------------------------------------------- discretionary spend
  const discretionary = round2(
    status
      .filter((c) => !routedCategories.has(c.category))
      .reduce((sum, c) => sum + Math.max(0, c.budgeted - c.spent), 0)
  )
  const remainingDays = Math.max(1, daysBetweenIso(today, endDate))
  const dailyBurn = round2(discretionary / remainingDays)

  // ------------------------------------------------------------------- income
  const income = estimatedIncome()
  if (income > 0) {
    events.push({ date: endDate, label: 'Estimated payday income', amount: income, kind: 'income', estimated: true })
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount)

  const balance = startBalance()
  const result = buildForecast({
    startDate: today,
    endDate,
    startBalance: balance,
    events,
    dailyBurn,
    lowBalanceBuffer: getSettingNumber('LOW_BALANCE_BUFFER', 50)
  })

  return {
    startDate: today,
    endDate,
    startBalance: balance,
    projectedEnd: result.endBalance,
    minBalance: result.minBalance,
    minDate: result.minDate,
    income: round2(income),
    committed: round2(
      events.filter((e) => e.kind === 'committed').reduce((s, e) => s + Math.abs(e.amount), 0)
    ),
    subscriptions: round2(subscriptionTotal),
    discretionary,
    dailyBurn,
    points: result.points,
    events,
    warnings: result.warnings
  }
}

/** Keep a payment date inside the forecast window (today … payday). */
function clampToHorizon(date: string, from: string, to: string): string {
  if (date < from) return from
  if (date > to) return to
  return date
}

/** One-line summary for the AI context and Discord. */
export function forecastLine(f: ForecastSummary): string {
  const parts = [`Projected ${money(f.projectedEnd)} on ${f.endDate}`]
  if (f.minBalance < f.startBalance) parts.push(`lowest ${money(f.minBalance)} on ${f.minDate}`)
  if (f.warnings.length > 0) parts.push(f.warnings[0])
  return parts.join(' · ')
}
