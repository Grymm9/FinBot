import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  annualIncrease,
  chargesPerYear,
  daysExhaustedEarly,
  isPriceIncrease,
  percentAbove,
  velocityExceeds
} from '../src/main/services/ai-alert-math.ts'

test('chargesPerYear annualises each recurring cadence', () => {
  assert.equal(chargesPerYear('monthly'), 12)
  assert.equal(chargesPerYear('quarterly'), 4)
  assert.equal(chargesPerYear('yearly'), 1)
  assert.equal(chargesPerYear('weekly'), 365.25 / 7)
  assert.equal(chargesPerYear('fortnightly'), 365.25 / 14)
  // Unknown cadences fall back to monthly rather than exploding.
  assert.equal(chargesPerYear('irregular'), 12)
})

test('annualIncrease only counts the extra money, annualised', () => {
  assert.equal(annualIncrease(15.99, 14.99, 'monthly'), 12)
  assert.equal(annualIncrease(16, 14, 'quarterly'), 8)
  assert.equal(annualIncrease(51, 50, 'weekly'), 52.18)
  // No rise (or a fall) adds nothing to the yearly baseline.
  assert.equal(annualIncrease(14.99, 14.99, 'monthly'), 0)
  assert.equal(annualIncrease(13.99, 14.99, 'monthly'), 0)
  assert.equal(annualIncrease(Number.NaN, 10, 'monthly'), 0)
})

test('percentAbove reports the gap to the baseline', () => {
  assert.equal(percentAbove(150, 100), 50)
  assert.equal(percentAbove(100, 100), 0)
  assert.equal(percentAbove(80, 100), -20)
  // A missing baseline is not treated as infinite acceleration.
  assert.equal(percentAbove(80, 0), 0)
})

test('isPriceIncrease ignores sub-cent rounding noise', () => {
  assert.equal(isPriceIncrease(11, 10), true)
  assert.equal(isPriceIncrease(10.02, 10), false)
  assert.equal(isPriceIncrease(9, 10), false)
  assert.equal(isPriceIncrease(10, 0), false)
})

test('velocityExceeds uses the 25% threshold', () => {
  assert.equal(velocityExceeds(125, 100), true)
  assert.equal(velocityExceeds(150, 100), true)
  assert.equal(velocityExceeds(124, 100), false)
  assert.equal(velocityExceeds(100, 0), false)
  assert.equal(velocityExceeds(125, 100, 30), false)
})

test('daysExhaustedEarly projects the current daily pace', () => {
  // $300 by day 10 = $30/day. A $600 allocation lasts 20 days, 10 days early.
  assert.equal(daysExhaustedEarly(300, 600, 10, 30), 10)
  // Already over budget: exhaustion happened even earlier.
  assert.equal(daysExhaustedEarly(600, 600, 10, 30), 20)
  // Spending below the pace needed to exhaust the allocation is not early.
  assert.equal(daysExhaustedEarly(100, 600, 10, 30), 0)
  // Zero-day and zero-budget input is safely ignored.
  assert.equal(daysExhaustedEarly(0, 600, 10, 30), 0)
  assert.equal(daysExhaustedEarly(100, 0, 10, 30), 0)
})
