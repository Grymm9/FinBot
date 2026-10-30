import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exceededAlertMessage, exceededBudgets, overspendKey } from '../src/main/services/alert-math.ts'

const flag = (category: string, spent: number, budgeted: number, projected = spent) => ({
  category,
  spent,
  budgeted,
  projected,
  ratio: budgeted > 0 ? Math.round((projected / budgeted) * 100) / 100 : 0
})

test('only categories actually over budget are flagged', () => {
  const flags = [
    flag('Groceries', 820, 800, 1000),
    flag('Fuel', 120, 120, 200),
    flag('Phone', 34, 19, 58),
    flag('Gym', 15.98, 31.96, 34)
  ]
  const exceeded = exceededBudgets(flags)
  assert.deepEqual(
    exceeded.map((f) => f.category),
    ['Phone', 'Groceries']
  )
})

test('a category exactly at budget is not "exceeded"', () => {
  assert.equal(exceededBudgets([flag('Fuel', 120, 120)]).length, 0)
  assert.equal(exceededBudgets([flag('Fuel', 119.99, 120)]).length, 0)
})

test('sub-cent float noise does not trigger an alert', () => {
  assert.equal(exceededBudgets([flag('Fuel', 120.0000001, 120)]).length, 0)
  assert.equal(exceededBudgets([flag('Fuel', 120.01, 120)]).length, 1)
})

test('zero-budget categories are ignored', () => {
  assert.equal(exceededBudgets([flag('Unbudgeted', 50, 0)]).length, 0)
})

test('the biggest overspend is listed first', () => {
  const exceeded = exceededBudgets([flag('Small', 60, 50), flag('Large', 300, 100), flag('Medium', 150, 100)])
  assert.deepEqual(
    exceeded.map((f) => f.category),
    ['Large', 'Medium', 'Small']
  )
})

test('the alert message reports actual spend and the overspend amount', () => {
  const message = exceededAlertMessage('13 Oct', [flag('Groceries', 820.5, 800)])
  assert.match(message, /Budget exceeded/)
  assert.match(message, /13 Oct/)
  assert.match(message, /Groceries/)
  assert.match(message, /\$820\.50 spent vs \$800\.00 budget \(\$20\.50 over\)/)
  assert.doesNotMatch(message, /on track for/)
})

test('the dedupe key is order-independent and changes when a category joins', () => {
  const a = overspendKey('2026-10-13', [flag('A', 10, 5), flag('B', 20, 5)])
  const b = overspendKey('2026-10-13', [flag('B', 20, 5), flag('A', 10, 5)])
  const c = overspendKey('2026-10-13', [flag('A', 10, 5), flag('B', 20, 5), flag('C', 30, 5)])
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, overspendKey('2026-11-13', [flag('A', 10, 5), flag('B', 20, 5)]))
})
