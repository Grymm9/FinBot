import type { DealCategory } from '@shared/types'

/**
 * Pure arithmetic for the deals catalogue. Nothing in here touches the
 * database or the network, so every rule below is covered by `test/deals.test.ts`.
 */

/** Average days in a month — the divisor for turning a daily charge into a month. */
export const DAYS_PER_MONTH = 365 / 12

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** A plan priced on a 4-weekly (28-day) cycle, expressed as a monthly cost. */
export function monthlyFromFourWeekly(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0
  return round2((price * (365 / 28)) / 12)
}

/**
 * Power plans are a daily fixed charge plus a rate per kWh. Comparing them on
 * the headline rate alone is wrong: a low rate with a high daily charge loses
 * for small households. Price against actual usage instead.
 */
export function powerMonthlyCost(variableRate: number, dailyCharge: number, kwh: number): number {
  const rate = Number.isFinite(variableRate) ? variableRate : 0
  const daily = Number.isFinite(dailyCharge) ? dailyCharge : 0
  const usage = Number.isFinite(kwh) ? Math.max(0, kwh) : 0
  return round2(daily * DAYS_PER_MONTH + rate * usage)
}

export function annualise(monthly: number): number {
  return round2(monthly * 12)
}

export interface PricedPlan {
  id: number
  category: DealCategory
  provider: string
  planName: string
  monthlyPrice: number | null
  variableRate: number | null
  dailyCharge: number | null
}

export interface RankedPlan<T extends PricedPlan = PricedPlan> {
  plan: T
  monthlyCost: number
  monthlySaving: number
  annualSaving: number
  isCurrent: boolean
}

/** Monthly cost of a plan at the given usage (power) — or its list price. */
export function planMonthlyCost(plan: PricedPlan, kwh: number): number {
  if (plan.category === 'power') {
    return powerMonthlyCost(plan.variableRate ?? 0, plan.dailyCharge ?? 0, kwh)
  }
  return round2(plan.monthlyPrice ?? 0)
}

/**
 * Rank plans cheapest first and work out the saving against what is being paid
 * now. A plan is "current" when its provider matches the one detected from the
 * bank feed.
 */
export function rankPlans<T extends PricedPlan>(
  plans: T[],
  opts: { currentMonthly: number | null; kwh: number; currentProvider: string | null }
): RankedPlan<T>[] {
  const current = opts.currentMonthly
  return plans
    .map((plan) => {
      const monthlyCost = planMonthlyCost(plan, opts.kwh)
      const saving = current === null ? 0 : round2(current - monthlyCost)
      return {
        plan,
        monthlyCost,
        monthlySaving: saving,
        annualSaving: annualise(saving),
        isCurrent:
          !!opts.currentProvider &&
          plan.provider.toLowerCase() === opts.currentProvider.toLowerCase()
      }
    })
    .sort((a, b) => a.monthlyCost - b.monthlyCost)
}

/** Whole days from one ISO date to another. Negative means `to` is in the past. */
export function daysBetweenIso(from: string, to: string): number {
  const a = isoToUtc(from)
  const b = isoToUtc(to)
  if (a === null || b === null) return 0
  return Math.round((b - a) / 86_400_000)
}

function isoToUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** True when `target` falls between today and `days` days from now (inclusive). */
export function withinDays(today: string, target: string, days: number): boolean {
  const delta = daysBetweenIso(today, target)
  return delta >= 0 && delta <= days
}

/**
 * A renewal that needs attention: inside the review window, and not already
 * handled for this renewal date.
 */
export function needsRenewalReview(today: string, target: string, windowDays = 7): boolean {
  return withinDays(today, target, windowDays)
}

/** Best (lowest-cost) plan, or null when the catalogue is empty. */
export function cheapest(ranked: RankedPlan[]): RankedPlan | null {
  return ranked.length > 0 ? ranked[0] : null
}

/** The largest saving worth mentioning, floored at zero. */
export function bestSaving(ranked: RankedPlan[]): number {
  const best = cheapest(ranked)
  if (!best) return 0
  return Math.max(0, best.monthlySaving)
}
