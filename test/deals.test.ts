import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  annualise,
  bestSaving,
  cheapest,
  DAYS_PER_MONTH,
  daysBetweenIso,
  monthlyFromFourWeekly,
  needsRenewalReview,
  planMonthlyCost,
  powerMonthlyCost,
  rankPlans,
  withinDays,
  type PricedPlan
} from '../src/main/services/deal-math.ts'

const plan = (over: Partial<PricedPlan> & Pick<PricedPlan, 'provider'>): PricedPlan => ({
  id: 1,
  category: 'broadband',
  planName: 'Test plan',
  monthlyPrice: 80,
  variableRate: null,
  dailyCharge: null,
  ...over
})

test('DAYS_PER_MONTH is the calendar average, not a rounded 30', () => {
  assert.equal(DAYS_PER_MONTH, 365 / 12)
})

test('power costs use both the daily charge and the per-kWh rate', () => {
  // $2.10/day + 24.5c/kWh at 400 kWh: 2.10*30.4167 + 98.00 = 161.875
  assert.equal(powerMonthlyCost(0.245, 2.1, 400), 161.88)
  // A high daily charge loses for a small user even with a cheaper rate.
  const small = powerMonthlyCost(0.2, 3, 150)
  const lowDaily = powerMonthlyCost(0.3, 1, 150)
  assert.ok(lowDaily < small)
  // A missing rate still prices the fixed charge.
  assert.equal(powerMonthlyCost(NaN, 2, 400), 60.83)
})

test('28-day plans annualise onto a month', () => {
  // Skinny's $13 28-day plan is advertised as about $14.12/month.
  assert.equal(monthlyFromFourWeekly(13), 14.12)
  assert.equal(monthlyFromFourWeekly(0), 0)
  assert.equal(monthlyFromFourWeekly(-5), 0)
})

test('planMonthlyCost ignores usage for fixed-price plans', () => {
  const bb = plan({ provider: 'Skinny', monthlyPrice: 93 })
  assert.equal(planMonthlyCost(bb, 9999), 93)
  const power = plan({
    provider: 'Contact',
    category: 'power',
    monthlyPrice: null,
    dailyCharge: 2,
    variableRate: 0.25
  })
  assert.equal(planMonthlyCost(power, 400), 160.83)
})

test('rankPlans orders cheapest first and calculates savings against today', () => {
  const plans = [
    plan({ id: 1, provider: 'Big', monthlyPrice: 110 }),
    plan({ id: 2, provider: 'Skinny', monthlyPrice: 75 }),
    plan({ id: 3, provider: 'Mid', monthlyPrice: 90 })
  ]
  const ranked = rankPlans(plans, { currentMonthly: 100, kwh: 0, currentProvider: 'Big' })

  assert.deepEqual(
    ranked.map((r) => r.plan.provider),
    ['Skinny', 'Mid', 'Big']
  )
  assert.equal(ranked[0].monthlySaving, 25)
  assert.equal(ranked[0].annualSaving, 300)
  assert.equal(ranked[1].monthlySaving, 10)
  assert.equal(ranked[2].monthlySaving, -10)
  assert.equal(ranked[2].annualSaving, -120)
  assert.equal(ranked[2].isCurrent, true)
  assert.equal(ranked[0].isCurrent, false)
})

test('rankPlans without a known current bill reports no saving', () => {
  const ranked = rankPlans([plan({ provider: 'Skinny', monthlyPrice: 75 })], {
    currentMonthly: null,
    kwh: 0,
    currentProvider: null
  })
  assert.equal(ranked[0].monthlySaving, 0)
  assert.equal(ranked[0].annualSaving, 0)
})

test('cheapest and bestSaving floor at zero and handle an empty catalogue', () => {
  assert.equal(cheapest([]), null)
  assert.equal(bestSaving([]), 0)

  const ranked = rankPlans(
    [plan({ id: 1, provider: 'A', monthlyPrice: 120 }), plan({ id: 2, provider: 'B', monthlyPrice: 90 })],
    { currentMonthly: 80, kwh: 0, currentProvider: null }
  )
  assert.equal(cheapest(ranked)?.plan.provider, 'B')
  // Everything is more expensive than today, so there is no saving to report.
  assert.equal(bestSaving(ranked), 0)
})

test('annualise rounds to cents', () => {
  assert.equal(annualise(14.12), 169.44)
  assert.equal(annualise(0.005), 0.06)
})

test('daysBetweenIso counts whole local days across the DST change', () => {
  assert.equal(daysBetweenIso('2026-09-26', '2026-09-28'), 2)
  assert.equal(daysBetweenIso('2026-10-29', '2026-10-29'), 0)
  assert.equal(daysBetweenIso('2026-11-05', '2026-10-29'), -7)
  assert.equal(daysBetweenIso('not-a-date', '2026-10-29'), 0)
})

test('the renewal window includes day 0 and day 7 but not day 8', () => {
  const today = '2026-10-29'
  assert.equal(withinDays(today, '2026-10-29', 7), true)
  assert.equal(withinDays(today, '2026-11-05', 7), true)
  assert.equal(withinDays(today, '2026-11-06', 7), false)
  assert.equal(withinDays(today, '2026-10-28', 7), false)

  assert.equal(needsRenewalReview(today, '2026-11-05'), true)
  assert.equal(needsRenewalReview(today, '2026-11-06'), false)
  assert.equal(needsRenewalReview(today, '2026-10-01'), false)
})
