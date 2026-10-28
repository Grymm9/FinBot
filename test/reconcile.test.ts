import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  daysBetween,
  daysIn,
  daysInto,
  netSpend,
  paceRatio,
  projectedSpend,
  round2
} from '../src/main/services/reconcile-math.ts'

test('round2 rounds to cents without float noise', () => {
  assert.equal(round2(0.1 + 0.2), 0.3)
  assert.equal(round2(1.234), 1.23)
  assert.equal(round2(1.236), 1.24)
  assert.equal(round2(-1.234), -1.23)
  assert.equal(round2(1234.5678), 1234.57)
})

test('netSpend subtracts reimbursements only for split categories', () => {
  assert.equal(netSpend(200, 50, true), 150)
  assert.equal(netSpend(200, 50, false), 200)
})

test('netSpend never goes negative when reimbursements exceed spend', () => {
  assert.equal(netSpend(40, 60, true), 0)
})

test('daysBetween counts whole local days in either direction', () => {
  assert.equal(daysBetween('2026-10-14', '2026-10-29'), 15)
  assert.equal(daysBetween('2026-10-29', '2026-10-14'), -15)
  assert.equal(daysBetween('2026-10-14', '2026-10-14'), 0)
})

test('daysBetween is DST-safe (NZ spring forward)', () => {
  // NZDT starts 27 Sep 2026; the wall clock gains an hour but days stay whole.
  assert.equal(daysBetween('2026-09-25', '2026-09-30'), 5)
  // NZDT ends 5 Apr 2026.
  assert.equal(daysBetween('2026-04-03', '2026-04-08'), 5)
})

test('daysInto is 1-based and clamped to at least 1', () => {
  assert.equal(daysInto('2026-10-14', '2026-10-14'), 1)
  assert.equal(daysInto('2026-10-14', '2026-10-29'), 16)
  // A date before the cycle start still reports day 1, never 0 or negative.
  assert.equal(daysInto('2026-10-14', '2026-10-10'), 1)
})

test('daysIn is the cycle length, at least 1', () => {
  assert.equal(daysIn('2026-10-14', '2026-11-13'), 30)
  assert.equal(daysIn('2026-10-14', '2026-10-14'), 1)
})

test('projectedSpend straight-lines spend to the end of the cycle', () => {
  assert.equal(projectedSpend(300, 10, 30), 900)
  assert.equal(projectedSpend(0, 10, 30), 0)
})

test('projectedSpend clamps early-cycle (zero-day) input', () => {
  // Day 0 is treated as day 1 so the projection is finite.
  assert.equal(projectedSpend(20, 0, 30), 600)
})

test('paceRatio compares projection against budget', () => {
  assert.equal(paceRatio(900, 600), 1.5)
  assert.equal(paceRatio(300, 600), 0.5)
  // No budget means no meaningful ratio rather than Infinity.
  assert.equal(paceRatio(500, 0), 0)
})
