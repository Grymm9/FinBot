import { getDb } from '../db'
import { listGroups, listCategoryDestinations } from './groups'
import { listCategories } from './budget'
import { monthlyAmount } from '@shared/frequency'
import { currentCycleRange } from './cycle'
import { FUNDING_TX } from './filters'
import { getSettingNumber } from './settings'
import { dismissedKeys } from './notifications'
import type { Deduction, MatchedPayment, MissedPayment } from '@shared/types'

/**
 * Detect routed destinations whose individual debit has not been detected in
 * the current income cycle. Both group destinations and singular-category
 * destinations are checked independently.
 *
 * A grace period (default 3 days into the cycle) avoids flagging payments
 * before their expected posting date. A destination can also be manually
 * matched (see `matchPayment`), in which case it is never flagged as missed.
 */
export function checkExpectedPayments(): MissedPayment[] {
  const cycle = currentCycleRange()
  const db = getDb()

  const grace = getSettingNumber('MISSED_GRACE_DAYS', 3)
  const now = new Date()
  const cycleStart = new Date(cycle.start + 'T00:00:00')
  const daysIntoCycle = Math.floor((now.getTime() - cycleStart.getTime()) / 86400000) + 1
  if (daysIntoCycle <= grace) return []

  const missed: MissedPayment[] = []
  const dismissed = dismissedKeys()

  const autoMatch = db.prepare(
    `SELECT id FROM transactions
     WHERE ${FUNDING_TX} AND amount < 0 AND ABS(ABS(amount) - ?) <= ? AND date >= ? AND date < ?
     LIMIT 1`
  )
  const manualMatch = db.prepare(
    'SELECT 1 AS x FROM payment_matches WHERE destination_id = ? AND kind = ? AND cycle_start = ?'
  )

  const catMonthly = new Map<string, number>()
  for (const c of listCategories()) catMonthly.set(c.name, monthlyAmount(c.amount, c.frequency))

  const check = (expected: number, destId: number, kind: 'group' | 'category'): boolean => {
    if (expected <= 0) return true
    const tol = Math.max(5, expected * 0.05)
    if (autoMatch.get(expected, tol, cycle.start, cycle.end)) return true
    if (manualMatch.get(destId, kind, cycle.start)) return true
    return false
  }

  for (const g of listGroups()) {
    for (const d of g.destinations) {
      const expected = d.amount ?? g.sum
      const key = `missed:group:${d.id}`
      if (check(expected, d.id, 'group') || dismissed.has(key)) continue
      missed.push({
        kind: 'group',
        groupId: g.id,
        destinationId: d.id,
        label: d.transferLabel ?? g.items.map((i) => i.category).join(' + '),
        amount: round2(expected),
        accountNumber: d.accountNumber,
        items: g.items.map((i) => i.category),
        key
      })
    }
  }

  for (const r of listCategoryDestinations()) {
    const catAmount = catMonthly.get(r.category) ?? 0
    for (const d of r.destinations) {
      const expected = d.amount ?? catAmount
      const key = `missed:category:${d.id}`
      if (check(expected, d.id, 'category') || dismissed.has(key)) continue
      missed.push({
        kind: 'category',
        groupId: 0,
        destinationId: d.id,
        label: d.transferLabel ?? r.category,
        amount: round2(expected),
        accountNumber: d.accountNumber,
        items: [r.category],
        key
      })
    }
  }

  return missed
}

/** Recent debit transactions (including internal transfers) for manual matching. */
export function listPaymentCandidates(limit = 200): Deduction[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.date, t.description, t.amount, a.name AS account
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id IN (SELECT id FROM accounts WHERE enabled = 1)
         AND t.amount < 0
       ORDER BY t.date DESC LIMIT ?`
    )
    .all(limit) as Deduction[]
}

/** Manually link a missed destination to a specific transaction for this cycle. */
export function matchPayment(destinationId: number, transactionId: string, kind: 'group' | 'category' = 'group'): MatchedPayment[] {
  const cycle = currentCycleRange()
  getDb()
    .prepare(
      'INSERT INTO payment_matches (destination_id, kind, transaction_id, cycle_start, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(destinationId, kind, transactionId, cycle.start, Date.now())
  return listMatchedPayments()
}

/** Remove a manual match for this cycle. */
export function unmatchPayment(destinationId: number, kind: 'group' | 'category' = 'group'): MatchedPayment[] {
  const cycle = currentCycleRange()
  getDb()
    .prepare('DELETE FROM payment_matches WHERE destination_id = ? AND kind = ? AND cycle_start = ?')
    .run(destinationId, kind, cycle.start)
  return listMatchedPayments()
}

/** All manually matched payments for the current cycle (with transaction details). */
export function listMatchedPayments(): MatchedPayment[] {
  const cycle = currentCycleRange()
  const db = getDb()
  const matches = db
    .prepare(
      `SELECT pm.destination_id, pm.kind, pm.transaction_id, t.date AS tx_date, t.description AS tx_desc, t.amount AS tx_amount
       FROM payment_matches pm JOIN transactions t ON t.id = pm.transaction_id
       WHERE pm.cycle_start = ? ORDER BY pm.id`
    )
    .all(cycle.start) as Array<{
    destination_id: number
    kind: string
    transaction_id: string
    tx_date: string
    tx_desc: string
    tx_amount: number
  }>

  const destMap = new Map<string, { label: string; amount: number; accountNumber: string | null }>()
  for (const g of listGroups()) {
    for (const d of g.destinations) {
      destMap.set(`group:${d.id}`, {
        label: d.transferLabel ?? g.items.map((i) => i.category).join(' + '),
        amount: d.amount ?? g.sum,
        accountNumber: d.accountNumber
      })
    }
  }
  const catMonthly = new Map<string, number>()
  for (const c of listCategories()) catMonthly.set(c.name, monthlyAmount(c.amount, c.frequency))
  for (const r of listCategoryDestinations()) {
    for (const d of r.destinations) {
      destMap.set(`category:${d.id}`, {
        label: d.transferLabel ?? r.category,
        amount: d.amount ?? catMonthly.get(r.category) ?? 0,
        accountNumber: d.accountNumber
      })
    }
  }

  return matches.map((m) => {
    const kind = m.kind === 'category' ? 'category' : 'group'
    const d = destMap.get(`${kind}:${m.destination_id}`)
    return {
      kind,
      destinationId: m.destination_id,
      label: d?.label ?? 'Payment',
      amount: d?.amount ?? 0,
      accountNumber: d?.accountNumber ?? null,
      transactionId: m.transaction_id,
      transactionDate: m.tx_date,
      transactionDescription: m.tx_desc,
      transactionAmount: m.tx_amount
    }
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
