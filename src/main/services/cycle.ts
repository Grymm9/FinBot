import { getSetting, getSettingNumber } from './settings'
import { parseLocalDate } from './dates'
import {
  anchoredStart as anchoredStartPure,
  currentRange,
  cycleStartFor as cycleStartForPure,
  iso as isoPure,
  monthPayDate,
  recentRanges,
  type CycleFrequency,
  type WeekendRule
} from './cycle-math'

/**
 * Income-cycle helpers. A "budget cycle" is the period over which we track
 * income and spend. It is defined by settings:
 *
 *   - INCOME_CYCLE_DAY       (1-31)    pay day-of-month — used for monthly pay.
 *   - INCOME_CYCLE_FREQUENCY monthly | fortnightly | weekly
 *   - INCOME_CYCLE_ANCHOR    (YYYY-MM-DD) a known payday, used as the anchor
 *                                      for fortnightly/weekly cycles.
 *   - INCOME_CYCLE_WEEKEND   previous | next | none  how a monthly payday that
 *                                      falls on a weekend is shifted.
 *
 * The arithmetic itself lives in `cycle-math.ts` (pure + unit-tested).
 */

export type { CycleFrequency }

export function cycleDay(): number {
  return getSettingNumber('INCOME_CYCLE_DAY', 15)
}

export function cycleFrequency(): CycleFrequency {
  const f = getSetting('INCOME_CYCLE_FREQUENCY', 'monthly')
  return f === 'fortnightly' || f === 'weekly' ? f : 'monthly'
}

/** Anchor payday for weekly/fortnightly cycles (falls back to today). */
function anchorDate(): Date {
  const raw = getSetting('INCOME_CYCLE_ANCHOR', '')
  if (raw) {
    const d = parseLocalDate(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

/** Number of days in a cycle, or 0 for monthly (month arithmetic). */
function intervalDays(freq: CycleFrequency): number {
  if (freq === 'weekly') return 7
  if (freq === 'fortnightly') return 14
  return 0
}

/** How a weekend payday is shifted: 'previous' (Fri) | 'next' (Mon) | 'none'. */
function weekendRule(): WeekendRule {
  const r = getSetting('INCOME_CYCLE_WEEKEND', 'previous')
  return r === 'next' || r === 'none' ? r : 'previous'
}

export const iso = isoPure

export function cycleStartFor(d: Date, day: number): Date {
  return cycleStartForPure(d, day, weekendRule())
}

export function cycleLabel(start: Date): string {
  return start.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' })
}

export interface CycleRange {
  start: string // inclusive YYYY-MM-DD
  end: string // exclusive YYYY-MM-DD
  label: string // "15 Oct"
}

function labelFor(startIso: string): string {
  return cycleLabel(parseLocalDate(startIso))
}

/** The current cycle (start/end/label). */
export function currentCycleRange(): CycleRange {
  const r = currentRange(new Date(), cycleFrequency(), cycleDay(), weekendRule(), anchorDate(), intervalDays(cycleFrequency()))
  return { ...r, label: labelFor(r.start) }
}

/** The last `count` cycle ranges, oldest first. */
export function recentCycleRanges(count: number): CycleRange[] {
  const freq = cycleFrequency()
  return recentRanges(new Date(), freq, cycleDay(), weekendRule(), anchorDate(), intervalDays(freq), count).map((r) => ({
    ...r,
    label: labelFor(r.start)
  }))
}

// Re-exported for callers that need the raw helpers without settings.
export { monthPayDate, anchoredStartPure as anchoredStart }
