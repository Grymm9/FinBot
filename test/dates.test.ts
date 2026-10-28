import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toLocalDate, detectTimeZone, isDateOnly } from '../src/main/services/dates.ts'

const NZ = 'Pacific/Auckland'

// Boundary case 1: a transaction just after local midnight lands in the NEW
// cycle (00:56 NZDT on 14 Oct = 11:56 UTC on 13 Oct).
test('00:56 NZDT on 14 Oct (UTC instant) → 2026-10-14', () => {
  assert.equal(toLocalDate('2026-10-13T11:56:00Z', NZ), '2026-10-14')
})

// The exact format Akahu returns for a NZ transaction dated 14 Oct.
test('Akahu raw.date "2026-10-13T11:00:00.000Z" → 2026-10-14', () => {
  assert.equal(toLocalDate('2026-10-13T11:00:00.000Z', NZ), '2026-10-14')
})

// A transaction just BEFORE local midnight stays in the previous day.
test('23:59 NZDT on 13 Oct (UTC instant) → 2026-10-13', () => {
  assert.equal(toLocalDate('2026-10-13T10:59:00Z', NZ), '2026-10-13')
})

// Boundary case 2: end of cycle. 23:30 NZDT on 13 Nov stays in the current
// cycle, not the next.
test('23:30 NZDT on 13 Nov → 2026-11-13 (current cycle)', () => {
  assert.equal(toLocalDate('2026-11-13T10:30:00Z', NZ), '2026-11-13')
})

// The instant 00:00 NZDT on 14 Nov (next cycle boundary) rolls forward.
test('00:00 NZDT on 14 Nov → 2026-11-14 (next cycle)', () => {
  assert.equal(toLocalDate('2026-11-13T11:00:00Z', NZ), '2026-11-14')
})

// Boundary case 3: date-only strings are already local — no offset applied.
test('date-only string is unchanged (no off-by-one)', () => {
  assert.equal(toLocalDate('2026-10-13', NZ), '2026-10-13')
  assert.equal(toLocalDate('2026-10-14', NZ), '2026-10-14')
})

// Boundary case 4: UTC-vs-local round trip via an explicit offset.
test('timestamp with +13:00 offset resolves to the same local date', () => {
  assert.equal(toLocalDate('2026-10-14T00:56:00+13:00', NZ), '2026-10-14')
  // Equivalent UTC instant of the above
  assert.equal(toLocalDate('2026-10-13T11:56:00Z', NZ), '2026-10-14')
})

// NZST (UTC+12) — winter dates are also handled correctly.
test('NZST midnight boundary (00:00 on 14 Jul) → 2026-07-14', () => {
  assert.equal(toLocalDate('2026-07-13T12:00:00Z', NZ), '2026-07-14')
})

test('isDateOnly distinguishes date-only from full timestamps', () => {
  assert.equal(isDateOnly('2026-10-13'), true)
  assert.equal(isDateOnly('2026-10-13T11:00:00Z'), false)
  assert.equal(isDateOnly('2026-10-13T00:00:00+13:00'), false)
})

test('detectTimeZone returns a non-empty string', () => {
  assert.ok(detectTimeZone().length > 0)
})
