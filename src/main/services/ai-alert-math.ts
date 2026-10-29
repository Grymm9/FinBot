/**
 * Pure arithmetic for the AI insight alerts. Nothing in here touches the
 * database, so every rule is covered by `test/ai-alerts.test.ts`.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** How many charges of a given cadence happen in a year. */
export function chargesPerYear(cadence: string): number {
  switch ((cadence || '').toLowerCase()) {
    case 'weekly':
      return 365.25 / 7
    case 'fortnightly':
      return 365.25 / 14
    case 'quarterly':
      return 4
    case 'yearly':
      return 1
    default:
      return 12
  }
}

/**
 * The extra money a price rise costs over a year, annualised from the charge
 * cadence. A $2 rise on a weekly plan is worth much more than on a yearly one.
 */
export function annualIncrease(current: number, previous: number, cadence: string): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0
  const delta = current - previous
  if (delta <= 0) return 0
  return round2(delta * chargesPerYear(cadence))
}

/** Percentage above a baseline, rounded to one decimal place. */
export function percentAbove(current: number, baseline: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return 0
  return round2(((current - baseline) / baseline) * 100)
}

/** True when a charge rose by more than `minFraction` (default 0.5%). */
export function isPriceIncrease(current: number, previous: number, minFraction = 0.005): boolean {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return false
  return current > previous && (current - previous) / previous > minFraction
}

/** A category is accelerating when it is at least `thresholdPercent` above baseline. */
export function velocityExceeds(current: number, baseline: number, thresholdPercent = 25): boolean {
  return baseline > 0 && percentAbove(current, baseline) >= thresholdPercent
}

/**
 * How many days before the end of the cycle the allocation would run out at
 * the current daily spend pace. Never negative: a slower pace returns 0.
 */
export function daysExhaustedEarly(
  spent: number,
  budgeted: number,
  dayNumber: number,
  totalDays: number
): number {
  if (spent <= 0 || budgeted <= 0 || totalDays <= 0) return 0
  const day = Math.max(1, Math.min(dayNumber, totalDays))
  const exhaustionDay = budgeted / (spent / day)
  return Math.max(0, Math.round(totalDays - exhaustionDay))
}
