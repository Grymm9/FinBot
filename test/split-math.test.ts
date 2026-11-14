import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAssetAccountType, normaliseSplits } from '../src/main/services/split-math.ts'

const categories = ['Groceries', 'Household', 'Fuel', 'Spending Money']

test('a split that adds up exactly is accepted', () => {
  const r = normaliseSplits(
    [
      { category: 'Groceries', amount: 80 },
      { category: 'Household', amount: 20 }
    ],
    categories,
    -100
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.splits, [
    { category: 'Groceries', amount: 80 },
    { category: 'Household', amount: 20 }
  ])
  assert.equal(r.totalCents, 10000)
  assert.equal(r.transactionCents, 10000)
})

test('a total mismatch reports both totals', () => {
  const r = normaliseSplits([{ category: 'Groceries', amount: 70 }], categories, -100)
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /\$70\.00/)
  assert.match(r.error ?? '', /\$100\.00/)
})

test('zero and negative split amounts are rejected', () => {
  for (const amount of [0, -5]) {
    const r = normaliseSplits([{ category: 'Groceries', amount }], categories, -100)
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /greater than zero/)
  }
})

test('an unknown category is rejected with the valid options', () => {
  const r = normaliseSplits([{ category: 'Holidays', amount: 100 }], categories, -100)
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /Unknown budget category "Holidays"/)
  assert.match(r.error ?? '', /Groceries/)
})

test('categories are matched case-insensitively and stored canonically', () => {
  const r = normaliseSplits([{ category: 'groceries', amount: 100 }], categories, -100)
  assert.equal(r.ok, true)
  assert.deepEqual(r.splits, [{ category: 'Groceries', amount: 100 }])
})

test('duplicate categories are merged', () => {
  const r = normaliseSplits(
    [
      { category: 'Groceries', amount: 40 },
      { category: 'groceries', amount: 35 },
      { category: 'Household', amount: 25 }
    ],
    categories,
    -100
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.splits, [
    { category: 'Groceries', amount: 75 },
    { category: 'Household', amount: 25 }
  ])
})

test('cent rounding does not reject an exact split', () => {
  const r = normaliseSplits(
    [
      { category: 'Groceries', amount: 33.33 },
      { category: 'Household', amount: 33.33 },
      { category: 'Fuel', amount: 33.34 }
    ],
    categories,
    -100
  )
  assert.equal(r.ok, true)
  assert.equal(r.totalCents, 10000)
})

test('a non-array or empty split list is rejected', () => {
  assert.equal(normaliseSplits(null, categories, -100).ok, false)
  assert.equal(normaliseSplits([], categories, -100).ok, false)
})

test('loan and asset account types are recognised', () => {
  for (const type of ['LOAN', 'Student Loan', 'SAVINGS', 'INVESTMENT', 'KIWISAVER', 'ASSET']) {
    assert.equal(isAssetAccountType(type), true, type)
  }
  for (const type of ['CHECKING', 'CREDITCARD', 'TRANSACTION', null, '']) {
    assert.equal(isAssetAccountType(type), false, String(type))
  }
})
