/**
 * Pure cash-flow forecast arithmetic.
 *
 * Kept free of database/settings access so it can be unit-tested directly
 * (see test/forecast.test.ts). `forecast.ts` is the settings-aware wrapper
 * that assembles the events from the budget, subscriptions and balances.
 */

import type { ForecastEvent, ForecastPoint } from '@shared/types'

/** Local YYYY-MM-DD from a Date (never UTC-sliced). */
export function isoOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Calendar-day arithmetic (DST-safe), mirroring cycle-math.addDays. */
export function addDaysIso(iso: string, days: number): string {
  const d = parseIso(iso)
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days))
}

/** Whole calendar days between two date-only strings. */
export function daysBetweenIso(from: string, to: string): number {
  const a = parseIso(from)
  const b = parseIso(to)
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86400000
  )
}

/** Add whole months, clamping to the last day of the target month. */
export function addMonthsIso(iso: string, months: number): string {
  const d = parseIso(iso)
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return isoOf(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)))
}

const CADENCE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12
}

/**
 * The next charge date for a recurring charge, on or after `notBefore`.
 * Anchored to the original charge date (not iterated) so month-end clamping
 * does not drift (31 Jan → 28 Feb → 31 Mar).
 */
export function nextOccurrence(lastDate: string, cadence: string, notBefore: string): string {
  if (cadence === 'weekly' || cadence === 'fortnightly') {
    const step = cadence === 'weekly' ? 7 : 14
    let next = addDaysIso(lastDate, step)
    // Guard against absurd gaps (e.g. a charge detected months ago).
    let guard = 0
    while (next < notBefore && guard < 260) {
      next = addDaysIso(next, step)
      guard++
    }
    return next
  }

  const months = CADENCE_MONTHS[cadence] ?? 1
  let k = 1
  let next = addMonthsIso(lastDate, months)
  while (next < notBefore && k < 240) {
    k++
    next = addMonthsIso(lastDate, months * k)
  }
  return next
}

/** Median of day-of-month values, used to estimate when a bill usually lands. */
export function medianDayOfMonth(dates: string[]): number | null {
  const days = dates
    .map((d) => parseIso(d).getDate())
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31)
    .sort((a, b) => a - b)
  if (days.length === 0) return null
  const mid = Math.floor(days.length / 2)
  return days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface ForecastInput {
  startDate: string // first day shown, usually today
  endDate: string // last day shown, usually the next payday
  startBalance: number
  events: ForecastEvent[]
  dailyBurn: number
  lowBalanceBuffer?: number
}

export interface ForecastResult {
  points: ForecastPoint[]
  minBalance: number
  minDate: string
  endBalance: number
  warnings: string[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Walk the calendar day by day, applying scheduled events and a steady
 * discretionary burn. Today's balance already reflects today's spending, so
 * the burn starts tomorrow.
 */
export function buildForecast(input: ForecastInput): ForecastResult {
  const { startDate, endDate, startBalance, events, dailyBurn } = input
  const buffer = input.lowBalanceBuffer ?? 0

  if (endDate < startDate) {
    return {
      points: [{ date: startDate, balance: round2(startBalance) }],
      minBalance: round2(startBalance),
      minDate: startDate,
      endBalance: round2(startBalance),
      warnings: []
    }
  }

  const byDate = new Map<string, number>()
  for (const e of events) {
    if (e.date < startDate || e.date > endDate) continue
    byDate.set(e.date, round2((byDate.get(e.date) ?? 0) + e.amount))
  }

  const points: ForecastPoint[] = []
  let balance = startBalance
  let minBalance = startBalance
  let minDate = startDate
  const totalDays = daysBetweenIso(startDate, endDate)

  for (let i = 0; i <= totalDays; i++) {
    const date = addDaysIso(startDate, i)
    balance += byDate.get(date) ?? 0
    if (i > 0) balance -= dailyBurn
    balance = round2(balance)
    points.push({ date, balance })
    if (balance < minBalance) {
      minBalance = balance
      minDate = date
    }
  }

  const warnings: string[] = []
  if (minBalance < 0) {
    warnings.push(`Projected to go negative on ${minDate} (${money(minBalance)}).`)
  } else if (buffer > 0 && minBalance < buffer) {
    warnings.push(`Balance dips to ${money(minBalance)} on ${minDate} — under your ${money(buffer)} buffer.`)
  }

  return {
    points,
    minBalance: round2(minBalance),
    minDate,
    endBalance: round2(balance),
    warnings
  }
}

export function money(n: number): string {
  const abs = Math.abs(n)
  const formatted = abs.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : ''}$${formatted}`
}
