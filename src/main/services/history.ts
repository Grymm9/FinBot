import { getDb } from '../db'
import { REAL_TX } from './filters'
import { recentCycleRanges } from './cycle'
import { computeBudgetStatus, totalReimbursements } from './budget'
import { todayLocalIso } from './dates'
import { round2 } from './reconcile-math'
import type { CycleHistoryEntry } from '@shared/types'

/**
 * Persist closed-cycle totals so the AI (and the user) can talk about history
 * rather than only the current cycle.
 *
 * - `cycle_history`    : one row per closed cycle with income / expense / net.
 * - `budget_history`   : per-category budgeted vs spent for that cycle
 *                        (the `month` column stores the cycle start date).
 *
 * Runs idempotently: inserts use INSERT OR IGNORE keyed on the cycle start.
 */

export function persistCycleHistory(lookback = 6): number {
  const today = todayLocalIso()
  const db = getDb()
  let written = 0

  const insertCycle = db.prepare(
    `INSERT INTO cycle_history (cycle_start, cycle_end, label, income, expense, net, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cycle_start) DO UPDATE SET
       cycle_end = excluded.cycle_end,
       label     = excluded.label,
       income    = excluded.income,
       expense   = excluded.expense,
       net       = excluded.net`
  )
  const insertBudget = db.prepare(
    `INSERT INTO budget_history (month, category, budgeted, spent) VALUES (?, ?, ?, ?)
     ON CONFLICT(month, category) DO UPDATE SET
       budgeted = excluded.budgeted,
       spent    = excluded.spent`
  )

  for (const range of recentCycleRanges(lookback)) {
    if (range.end > today) continue // not finished yet

    const incomeRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS v FROM transactions
         WHERE ${REAL_TX} AND amount > 0 AND date >= ? AND date < ?`
      )
      .get(range.start, range.end) as { v: number }
    const expenseRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS v FROM transactions
         WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?`
      )
      .get(range.start, range.end) as { v: number }

    const reimbursements = totalReimbursements(range.start, range.end)
    const income = round2(incomeRow.v - reimbursements)
    const expense = round2(Math.abs(expenseRow.v))

    const info = insertCycle.run(
      range.start,
      range.end,
      range.label,
      income,
      expense,
      round2(income - expense),
      Date.now()
    )
    if (info.changes > 0) written++

    for (const c of computeBudgetStatus(range.start, range.end)) {
      if (c.budgeted <= 0 && c.spent <= 0) continue
      insertBudget.run(range.start, c.category, c.budgeted, c.spent)
    }
  }

  return written
}

export function listCycleHistory(limit = 6): CycleHistoryEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT cycle_start, cycle_end, label, income, expense, net
       FROM cycle_history ORDER BY cycle_start DESC LIMIT ?`
    )
    .all(limit) as Array<{
    cycle_start: string
    cycle_end: string
    label: string | null
    income: number
    expense: number
    net: number
  }>

  return rows.map((r) => ({
    cycleStart: r.cycle_start,
    cycleEnd: r.cycle_end,
    label: r.label ?? r.cycle_start,
    income: r.income,
    expense: r.expense,
    net: r.net
  }))
}

/** Top overspends for a given cycle start (used by the AI context). */
export function topCategoryVariance(
  cycleStart: string,
  limit = 5
): Array<{ category: string; budgeted: number; spent: number; variance: number }> {
  const rows = getDb()
    .prepare(
      `SELECT category, budgeted, spent FROM budget_history WHERE month = ? ORDER BY spent - budgeted DESC LIMIT ?`
    )
    .all(cycleStart, limit) as Array<{ category: string; budgeted: number; spent: number }>

  return rows.map((r) => ({
    category: r.category,
    budgeted: r.budgeted,
    spent: r.spent,
    variance: round2(r.spent - r.budgeted)
  }))
}
