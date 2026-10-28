/**
 * Pure reconciliation maths shared by the budget engine and the alert engine.
 * Extracted so the money arithmetic can be unit-tested without a database.
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Net spend for a category: gross debits minus incoming reimbursements, but
 * only when the category is flagged as `split`. Never returns a negative
 * spend (a refund larger than the spend is treated as zero).
 */
export function netSpend(gross: number, reimbursed: number, split: boolean): number {
  return split ? Math.max(0, gross - reimbursed) : gross
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00')
  const b = new Date(bIso + 'T00:00:00')
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** How many days into the cycle `now` is (1-based, clamped to >= 1). */
export function daysInto(startIso: string, nowIso: string): number {
  return Math.max(1, daysBetween(startIso, nowIso) + 1)
}

/** Total days in the cycle (>= 1). */
export function daysIn(startIso: string, endIso: string): number {
  return Math.max(1, daysBetween(startIso, endIso))
}

/**
 * Straight-line projection of the cycle-end spend from spend-to-date.
 * Days-elapsed is clamped to at least 1 so early-cycle projections are finite.
 */
export function projectedSpend(spent: number, daysElapsed: number, totalDays: number): number {
  const elapsed = Math.max(1, daysElapsed)
  return (spent / elapsed) * Math.max(1, totalDays)
}

/** Projected spend as a ratio of the budget (>1 means projected overspend). */
export function paceRatio(projected: number, budgeted: number): number {
  if (budgeted <= 0) return 0
  return projected / budgeted
}
