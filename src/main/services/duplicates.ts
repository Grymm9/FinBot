import { getDb } from '../db'
import { REAL_TX } from './filters'
import { currentCycleRange } from './cycle'
import { dismissedKeys } from './notifications'
import type { DuplicateCharge } from '@shared/types'

/**
 * Flag identical merchant + amount charges that occur within `days` of each
 * other (e.g. Rocket Mobile $17.00 on the 15th and 19th). Groups by merchant
 * text + absolute amount and only reports groups with 2+ occurrences inside
 * the window.
 */
export function detectDuplicateCharges(days = 7): DuplicateCharge[] {
  const db = getDb()
  const { start, end } = currentCycleRange()
  const rows = db
    .prepare(
      `SELECT id, date, description, amount, merchant FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?
       ORDER BY date`
    )
    .all(start, end) as Array<{ id: string; date: string; description: string; amount: number; merchant: string | null }>

  const groups = new Map<string, { amount: number; dates: string[]; ids: string[]; label: string }>()
  for (const r of rows) {
    const amt = round2(Math.abs(r.amount))
    const label = r.merchant ?? stripCardPrefix(r.description)
    const key = `${norm(label)}|${amt}`
    const g = groups.get(key) ?? { amount: amt, dates: [], ids: [], label }
    g.dates.push(r.date)
    g.ids.push(r.id)
    groups.set(key, g)
  }

  const out: DuplicateCharge[] = []
  const dismissed = dismissedKeys()
  for (const g of groups.values()) {
    if (g.ids.length < 2) continue
    const sorted = [...g.dates].sort()
    const closeEnough = sorted.some((d, i) => i > 0 && daysBetween(sorted[i - 1], d) <= days)
    if (!closeEnough) continue
    const key = `duplicate:${norm(g.label)}|${g.amount}`
    if (dismissed.has(key)) continue
    out.push({
      merchant: g.label,
      amount: g.amount,
      count: g.ids.length,
      firstDate: sorted[0],
      lastDate: sorted[sorted.length - 1],
      transactionIds: g.ids,
      key
    })
  }
  return out.sort((a, b) => b.amount - a.amount)
}

function stripCardPrefix(description: string): string {
  return description.replace(/^card\s+\d{3,4}\s*/i, '').trim() || description
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}
