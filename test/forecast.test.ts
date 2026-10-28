import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDaysIso,
  addMonthsIso,
  buildForecast,
  daysBetweenIso,
  medianDayOfMonth,
  nextOccurrence
} from '../src/main/services/forecast-math.ts'

test('addDaysIso stays on the local calendar across the NZ DST change', () => {
  // NZDT starts 27 Sep 2026 — fixed-millisecond arithmetic drifts here.
  assert.equal(addDaysIso('2026-09-26', 1), '2026-09-27')
  assert.equal(addDaysIso('2026-09-27', 1), '2026-09-28')
  assert.equal(daysBetweenIso('2026-09-26', '2026-09-28'), 2)
})

test('addMonthsIso clamps to the end of shorter months', () => {
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsIso('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonthsIso('2026-11-14', 2), '2027-01-14')
})

test('nextOccurrence advances weekly and fortnightly cadences', () => {
  assert.equal(nextOccurrence('2026-10-01', 'weekly', '2026-10-02'), '2026-10-08')
  assert.equal(nextOccurrence('2026-10-01', 'weekly', '2026-10-20'), '2026-10-22')
  assert.equal(nextOccurrence('2026-10-01', 'fortnightly', '2026-10-02'), '2026-10-15')
})

test('nextOccurrence is anchored to the original date (no month-end drift)', () => {
  // A charge on the 31st: Feb is clamped to 28, but March returns to the 31st.
  assert.equal(nextOccurrence('2026-01-31', 'monthly', '2026-02-01'), '2026-02-28')
  assert.equal(nextOccurrence('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31')
  assert.equal(nextOccurrence('2026-03-31', 'quarterly', '2026-04-01'), '2026-06-30')
})

test('medianDayOfMonth picks the typical billing day', () => {
  assert.equal(medianDayOfMonth(['2026-08-14', '2026-09-14', '2026-10-14']), 14)
  assert.equal(medianDayOfMonth(['2026-08-01', '2026-09-20', '2026-10-21']), 20)
  assert.equal(medianDayOfMonth([]), null)
})

test('buildForecast applies events and a daily burn, and reports the low point', () => {
  const result = buildForecast({
    startDate: '2026-10-29',
    endDate: '2026-11-02',
    startBalance: 1000,
    events: [
      { date: '2026-10-30', label: 'Rent', amount: -300, kind: 'committed' },
      { date: '2026-11-02', label: 'Pay', amount: 2000, kind: 'income' }
    ],
    dailyBurn: 50
  })

  assert.equal(result.points.length, 5)
  assert.equal(result.points[0].balance, 1000) // today is untouched by burn
  assert.equal(result.points[1].balance, 650) // -300 rent -50 burn
  assert.equal(result.points[2].balance, 600)
  assert.equal(result.points[3].balance, 550)
  assert.equal(result.points[4].balance, 2500) // +2000 pay -50 burn
  assert.equal(result.minBalance, 550)
  assert.equal(result.minDate, '2026-11-01')
  assert.deepEqual(result.warnings, [])
})

test('buildForecast warns when the balance is projected to go negative', () => {
  const result = buildForecast({
    startDate: '2026-10-29',
    endDate: '2026-11-05',
    startBalance: 100,
    events: [{ date: '2026-10-31', label: 'Insurance', amount: -400, kind: 'committed' }],
    dailyBurn: 0,
    lowBalanceBuffer: 50
  })
  assert.equal(result.minBalance, -300)
  assert.equal(result.minDate, '2026-10-31')
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /go negative/)
})

test('buildForecast warns when the low point is inside the buffer', () => {
  const result = buildForecast({
    startDate: '2026-10-29',
    endDate: '2026-10-31',
    startBalance: 120,
    events: [{ date: '2026-10-30', label: 'Power', amount: -90, kind: 'committed' }],
    dailyBurn: 0,
    lowBalanceBuffer: 50
  })
  assert.equal(result.minBalance, 30)
  assert.match(result.warnings[0], /under your \$50\.00 buffer/)
})

test('buildForecast with no events still applies the burn', () => {
  const result = buildForecast({
    startDate: '2026-10-29',
    endDate: '2026-11-01',
    startBalance: 500,
    events: [],
    dailyBurn: 25
  })
  assert.equal(result.endBalance, 425)
  assert.equal(result.points.length, 4)
})

test('an inverted window returns a single point instead of throwing', () => {
  const result = buildForecast({
    startDate: '2026-11-05',
    endDate: '2026-11-01',
    startBalance: 42,
    events: [],
    dailyBurn: 0
  })
  assert.equal(result.points.length, 1)
  assert.equal(result.endBalance, 42)
})
