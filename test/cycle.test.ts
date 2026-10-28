import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anchoredStart,
  currentRange,
  cycleStartFor,
  iso,
  monthPayDate,
  recentRanges,
  shiftToBusinessDay
} from '../src/main/services/cycle-math.ts'

const d = (y: number, m: number, day: number): Date => new Date(y, m - 1, day)

test('iso formats local dates without a UTC shift', () => {
  assert.equal(iso(d(2026, 10, 14)), '2026-10-14')
  assert.equal(iso(d(2026, 1, 2)), '2026-01-02')
})

test('weekend paydays shift to the previous business day', () => {
  // Sat 17 Oct 2026 → Fri 16 Oct
  assert.equal(iso(shiftToBusinessDay(d(2026, 10, 17), 'previous')), '2026-10-16')
  // Sun 18 Oct 2026 → Fri 16 Oct
  assert.equal(iso(shiftToBusinessDay(d(2026, 10, 18), 'previous')), '2026-10-16')
  // Weekdays are untouched
  assert.equal(iso(shiftToBusinessDay(d(2026, 10, 14), 'previous')), '2026-10-14')
})

test('weekend paydays shift to the next business day when configured', () => {
  assert.equal(iso(shiftToBusinessDay(d(2026, 10, 17), 'next')), '2026-10-19')
  assert.equal(iso(shiftToBusinessDay(d(2026, 10, 18), 'next')), '2026-10-19')
})

test("rule 'none' never shifts a payday", () => {
  assert.equal(iso(shiftToBusinessDay(d(2026, 10, 17), 'none')), '2026-10-17')
  assert.equal(iso(shiftToBusinessDay(d(2026, 10, 18), 'none')), '2026-10-18')
})

test('monthPayDate handles year boundaries', () => {
  assert.equal(iso(monthPayDate(2026, 11, 14, 'previous')), '2026-12-14')
  assert.equal(iso(monthPayDate(2027, -1, 14, 'previous')), '2026-12-14')
})

test('cycleStartFor picks the current payday or the previous one', () => {
  // Payday is the 14th. On the 13th, we are still in the prior cycle.
  assert.equal(iso(cycleStartFor(d(2026, 10, 13), 14, 'previous')), '2026-09-14')
  assert.equal(iso(cycleStartFor(d(2026, 10, 14), 14, 'previous')), '2026-10-14')
  assert.equal(iso(cycleStartFor(d(2026, 10, 29), 14, 'previous')), '2026-10-14')
})

test('monthly currentRange runs payday to the day before the next payday', () => {
  // Nov 14 2026 is a Saturday, so the next cycle starts Fri 13 Nov.
  const r = currentRange(d(2026, 10, 29), 'monthly', 14, 'previous', d(2026, 1, 1), 0)
  assert.deepEqual(r, { start: '2026-10-14', end: '2026-11-13' })
})

test('monthly currentRange respects the weekend rule at the start', () => {
  // Nov payday was shifted back to Fri 13 Nov, so the current cycle starts there.
  const r = currentRange(d(2026, 11, 20), 'monthly', 14, 'previous', d(2026, 1, 1), 0)
  assert.deepEqual(r, { start: '2026-11-13', end: '2026-12-14' })
})

test('anchoredStart snaps to the most recent anchor interval', () => {
  assert.equal(iso(anchoredStart(d(2026, 10, 20), d(2026, 10, 1), 14)), '2026-10-15')
  assert.equal(iso(anchoredStart(d(2026, 10, 1), d(2026, 10, 1), 14)), '2026-10-01')
})

test('fortnightly currentRange is a 14-day window from the anchor', () => {
  const r = currentRange(d(2026, 10, 20), 'fortnightly', 14, 'previous', d(2026, 10, 1), 14)
  assert.deepEqual(r, { start: '2026-10-15', end: '2026-10-29' })
})

test('recentRanges returns contiguous monthly cycles, oldest first', () => {
  const ranges = recentRanges(d(2026, 10, 29), 'monthly', 14, 'previous', d(2026, 1, 1), 0, 3)
  assert.equal(ranges.length, 3)
  // Each range ends exactly where the next begins.
  assert.equal(ranges[0].end, ranges[1].start)
  assert.equal(ranges[1].end, ranges[2].start)
  // The newest range is the current cycle.
  assert.deepEqual(ranges[2], { start: '2026-10-14', end: '2026-11-13' })
  // The oldest starts two paydays earlier.
  assert.equal(ranges[0].start, '2026-08-14')
})

test('recentRanges returns contiguous fortnightly windows', () => {
  const ranges = recentRanges(d(2026, 10, 20), 'fortnightly', 14, 'previous', d(2026, 10, 1), 14, 3)
  assert.deepEqual(ranges, [
    { start: '2026-09-17', end: '2026-10-01' },
    { start: '2026-10-01', end: '2026-10-15' },
    { start: '2026-10-15', end: '2026-10-29' }
  ])
})
