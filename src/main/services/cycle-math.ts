/**
 * Pure income-cycle arithmetic.
 *
 * Kept free of settings/database access so it can be unit-tested directly
 * (see test/cycle.test.ts). `cycle.ts` is the thin settings-aware wrapper.
 */

export type CycleFrequency = 'monthly' | 'fortnightly' | 'weekly'
export type WeekendRule = 'previous' | 'next' | 'none'

export interface RawRange {
  start: string // inclusive YYYY-MM-DD
  end: string // exclusive YYYY-MM-DD
}

export function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a payday that falls on a weekend to a business day. */
export function shiftToBusinessDay(d: Date, rule: WeekendRule): Date {
  if (rule === 'none') return d
  const wd = d.getDay() // 0 = Sunday, 6 = Saturday
  if (wd === 6) {
    return rule === 'next'
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
  }
  if (wd === 0) {
    return rule === 'next'
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2)
  }
  return d
}

/** The (weekend-adjusted) payday in a given month. */
export function monthPayDate(year: number, month: number, day: number, rule: WeekendRule): Date {
  return shiftToBusinessDay(new Date(year, month, day), rule)
}

/** Start of the monthly cycle containing `d` (day-of-month based). */
export function cycleStartFor(d: Date, day: number, rule: WeekendRule): Date {
  const thisMonth = monthPayDate(d.getFullYear(), d.getMonth(), day, rule)
  if (d.getTime() >= thisMonth.getTime()) return thisMonth
  return monthPayDate(d.getFullYear(), d.getMonth() - 1, day, rule)
}

/**
 * Add whole days using local calendar components. Fixed-millisecond arithmetic
 * drifts by an hour across a DST change, which can knock a cycle boundary onto
 * the wrong date in NZ.
 */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
}

/** Day number derived from local Y/M/D (UTC-normalised so DST is irrelevant). */
function dayIndex(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

/** Most recent anchored cycle start at or before `now`. */
export function anchoredStart(now: Date, anchor: Date, intervalDays: number): Date {
  const days = Math.max(0, intervalDays)
  if (days <= 0) return anchor
  const k = Math.floor((dayIndex(now) - dayIndex(anchor)) / days)
  return addDays(anchor, k * days)
}

function monthlyStart(now: Date, day: number, rule: WeekendRule, offsetMonths: number): Date {
  const current = cycleStartFor(now, day, rule)
  return monthPayDate(current.getFullYear(), current.getMonth() + offsetMonths, day, rule)
}

/** The cycle containing `now`. */
export function currentRange(
  now: Date,
  freq: CycleFrequency,
  day: number,
  rule: WeekendRule,
  anchor: Date,
  intervalDays: number
): RawRange {
  if (freq === 'monthly') {
    const start = cycleStartFor(now, day, rule)
    const end = monthPayDate(start.getFullYear(), start.getMonth() + 1, day, rule)
    return { start: iso(start), end: iso(end) }
  }
  const start = anchoredStart(now, anchor, intervalDays)
  const end = addDays(start, intervalDays)
  return { start: iso(start), end: iso(end) }
}

/** The last `count` ranges, oldest first (includes the current one). */
export function recentRanges(
  now: Date,
  freq: CycleFrequency,
  day: number,
  rule: WeekendRule,
  anchor: Date,
  intervalDays: number,
  count: number
): RawRange[] {
  const out: RawRange[] = []
  if (freq === 'monthly') {
    for (let i = count - 1; i >= 0; i--) {
      const start = monthlyStart(now, day, rule, -i)
      const end = monthPayDate(start.getFullYear(), start.getMonth() + 1, day, rule)
      out.push({ start: iso(start), end: iso(end) })
    }
    return out
  }
  const start = anchoredStart(now, anchor, intervalDays)
  for (let i = count - 1; i >= 0; i--) {
    const s = addDays(start, -i * intervalDays)
    const e = addDays(s, intervalDays)
    out.push({ start: iso(s), end: iso(e) })
  }
  return out
}
