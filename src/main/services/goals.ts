import { getDb } from '../db'
import { daysBetween, round2 } from './reconcile-math'
import { todayLocalIso } from './dates'
import type { Goal } from '@shared/types'

interface GoalRow {
  id: number
  name: string
  target_amount: number
  saved_amount: number
  target_date: string | null
  created_at: number | null
  updated_at: number | null
}

function mapRow(r: GoalRow): Goal {
  return {
    id: r.id,
    name: r.name,
    targetAmount: r.target_amount,
    savedAmount: r.saved_amount,
    targetDate: r.target_date,
    createdAt: r.created_at ?? 0,
    updatedAt: r.updated_at ?? r.created_at ?? 0
  }
}

const SELECT = 'SELECT id, name, target_amount, saved_amount, target_date, created_at, updated_at FROM goals'

export function listGoals(): Goal[] {
  const rows = getDb().prepare(`${SELECT} ORDER BY created_at ASC, id ASC`).all() as GoalRow[]
  return rows.map(mapRow)
}

export function createGoal(
  name: string,
  targetAmount: number,
  savedAmount = 0,
  targetDate: string | null = null
): Goal | null {
  const clean = name.trim()
  if (!clean) return null
  const now = Date.now()
  const info = getDb()
    .prepare(
      'INSERT INTO goals (name, target_amount, saved_amount, target_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(clean, round2(Math.max(0, targetAmount)), round2(Math.max(0, savedAmount)), targetDate || null, now, now)
  return listGoals().find((g) => g.id === Number(info.lastInsertRowid)) ?? null
}

export function updateGoal(
  id: number,
  fields: { name?: string; targetAmount?: number; savedAmount?: number; targetDate?: string | null }
): Goal | null {
  const before = listGoals().find((g) => g.id === id)
  if (!before) return null
  const name = fields.name !== undefined ? fields.name.trim() || before.name : before.name
  getDb()
    .prepare(
      'UPDATE goals SET name = ?, target_amount = ?, saved_amount = ?, target_date = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      name,
      round2(fields.targetAmount !== undefined ? Math.max(0, fields.targetAmount) : before.targetAmount),
      round2(fields.savedAmount !== undefined ? Math.max(0, fields.savedAmount) : before.savedAmount),
      fields.targetDate !== undefined ? fields.targetDate || null : before.targetDate,
      Date.now(),
      id
    )
  return listGoals().find((g) => g.id === id) ?? null
}

/** Add (or subtract, with a negative amount) to a goal's saved total. */
export function contributeToGoal(id: number, amount: number): Goal | null {
  const goal = listGoals().find((g) => g.id === id)
  if (!goal) return null
  return updateGoal(id, { savedAmount: goal.savedAmount + amount })
}

export function deleteGoal(id: number): boolean {
  return getDb().prepare('DELETE FROM goals WHERE id = ?').run(id).changes > 0
}

/** Progress details for a goal, including the weekly amount needed by its date. */
export function goalProgress(goal: Goal): {
  remaining: number
  percent: number
  weeksLeft: number | null
  perWeek: number | null
} {
  const remaining = round2(Math.max(0, goal.targetAmount - goal.savedAmount))
  const percent = goal.targetAmount > 0 ? Math.min(100, (goal.savedAmount / goal.targetAmount) * 100) : 0
  let weeksLeft: number | null = null
  let perWeek: number | null = null
  if (goal.targetDate) {
    const days = daysBetween(todayLocalIso(), goal.targetDate)
    if (days > 0) {
      weeksLeft = Math.max(1, Math.round((days / 7) * 10) / 10)
      perWeek = round2(remaining / weeksLeft)
    }
  }
  return { remaining, percent: round2(percent), weeksLeft, perWeek }
}
