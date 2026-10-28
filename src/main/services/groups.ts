import { getDb } from '../db'
import { monthlyAmount } from '@shared/frequency'
import type { BudgetGroup, BudgetGroupDestination, CategoryDestination, CategoryRouting } from '@shared/types'

interface DestRow {
  id: number
  group_id: number
  amount: number | null
  account_number: string | null
  account_type: string | null
  transfer_label: string | null
}

export function listGroups(): BudgetGroup[] {
  const db = getDb()

  const itemRows = db
    .prepare(
      `SELECT gi.group_id, c.name AS category, c.amount AS amount, c.frequency AS frequency
       FROM budget_group_items gi JOIN categories c ON c.name = gi.category`
    )
    .all() as Array<{ group_id: number; category: string; amount: number; frequency: string }>

  const destRows = db
    .prepare('SELECT id, group_id, amount, account_number, account_type, transfer_label FROM budget_group_destinations ORDER BY id')
    .all() as DestRow[]

  const groupIds = db.prepare('SELECT id FROM budget_groups ORDER BY id').all() as Array<{ id: number }>

  const itemsByGroup = new Map<number, BudgetGroup['items']>()
  for (const r of itemRows) {
    const list = itemsByGroup.get(r.group_id) ?? []
    list.push({ category: r.category, amount: round2(monthlyAmount(r.amount, r.frequency)) })
    itemsByGroup.set(r.group_id, list)
  }

  const destsByGroup = new Map<number, BudgetGroupDestination[]>()
  for (const r of destRows) {
    const list = destsByGroup.get(r.group_id) ?? []
    list.push({
      id: r.id,
      amount: r.amount,
      accountNumber: r.account_number,
      accountType: r.account_type,
      transferLabel: r.transfer_label
    })
    destsByGroup.set(r.group_id, list)
  }

  return groupIds.map(({ id }) => {
    const items = itemsByGroup.get(id) ?? []
    const sum = round2(items.reduce((s, i) => s + i.amount, 0))
    return { id, items, sum, destinations: destsByGroup.get(id) ?? [] }
  })
}

export function createGroup(categories: string[]): BudgetGroup[] {
  const db = getDb()
  const info = db.prepare('INSERT INTO budget_groups (created_at) VALUES (?)').run(Date.now())
  const id = Number(info.lastInsertRowid)
  const ins = db.prepare('INSERT OR IGNORE INTO budget_group_items (group_id, category) VALUES (?, ?)')
  for (const c of categories) ins.run(id, c)
  return listGroups()
}

function groupRemaining(groupId: number): number {
  const g = listGroups().find((x) => x.id === groupId)
  if (!g) return 0
  const allocated = g.destinations.reduce((s, d) => s + (d.amount ?? 0), 0)
  return round2(g.sum - allocated)
}

export function addDestination(
  groupId: number,
  fields: {
    amount?: number | null
    accountNumber?: string | null
    accountType?: string | null
    transferLabel?: string | null
  }
): BudgetGroup[] {
  const db = getDb()
  const amount = fields.amount ?? groupRemaining(groupId)
  db.prepare(
    'INSERT INTO budget_group_destinations (group_id, amount, account_number, account_type, transfer_label) VALUES (?, ?, ?, ?, ?)'
  ).run(groupId, amount, fields.accountNumber ?? null, fields.accountType ?? null, fields.transferLabel ?? null)
  return listGroups()
}

export function updateDestination(
  destId: number,
  fields: {
    amount?: number | null
    accountNumber?: string | null
    accountType?: string | null
    transferLabel?: string | null
  }
): BudgetGroup[] {
  const db = getDb()
  const existing = db
    .prepare('SELECT amount, account_number, account_type, transfer_label FROM budget_group_destinations WHERE id = ?')
    .get(destId) as DestRow | undefined
  if (!existing) return listGroups()

  db.prepare(
    'UPDATE budget_group_destinations SET amount = ?, account_number = ?, account_type = ?, transfer_label = ? WHERE id = ?'
  ).run(
    fields.amount !== undefined ? fields.amount : existing.amount,
    fields.accountNumber !== undefined ? fields.accountNumber : existing.account_number,
    fields.accountType !== undefined ? fields.accountType : existing.account_type,
    fields.transferLabel !== undefined ? fields.transferLabel : existing.transfer_label,
    destId
  )
  return listGroups()
}

export function removeDestination(destId: number): BudgetGroup[] {
  getDb().prepare('DELETE FROM budget_group_destinations WHERE id = ?').run(destId)
  return listGroups()
}

export function deleteGroup(id: number): BudgetGroup[] {
  const db = getDb()
  db.prepare('DELETE FROM budget_group_items WHERE group_id = ?').run(id)
  db.prepare('DELETE FROM budget_group_destinations WHERE group_id = ?').run(id)
  db.prepare('DELETE FROM budget_groups WHERE id = ?').run(id)
  return listGroups()
}

export function removeGroupItem(groupId: number, category: string): BudgetGroup[] {
  getDb().prepare('DELETE FROM budget_group_items WHERE group_id = ? AND category = ?').run(groupId, category)
  return listGroups()
}

export function addGroupItem(groupId: number, category: string): BudgetGroup[] {
  getDb().prepare('INSERT OR IGNORE INTO budget_group_items (group_id, category) VALUES (?, ?)').run(groupId, category)
  return listGroups()
}

// ---------------------------------------------------------------------------
// Singular category routing (destinations on a standalone budget item)
// ---------------------------------------------------------------------------

interface CatDestRow {
  id: number
  category: string
  amount: number | null
  account_number: string | null
  account_type: string | null
  transfer_label: string | null
}

export function listCategoryDestinations(): CategoryRouting[] {
  const rows = getDb()
    .prepare('SELECT id, category, amount, account_number, account_type, transfer_label FROM category_destinations ORDER BY id')
    .all() as CatDestRow[]

  const map = new Map<string, CategoryDestination[]>()
  for (const r of rows) {
    const list = map.get(r.category) ?? []
    list.push({
      id: r.id,
      amount: r.amount,
      accountNumber: r.account_number,
      accountType: r.account_type,
      transferLabel: r.transfer_label
    })
    map.set(r.category, list)
  }
  return [...map.entries()].map(([category, destinations]) => ({ category, destinations }))
}

export function addCategoryDestination(
  category: string,
  fields: {
    amount?: number | null
    accountNumber?: string | null
    accountType?: string | null
    transferLabel?: string | null
  }
): CategoryRouting[] {
  getDb()
    .prepare('INSERT INTO category_destinations (category, amount, account_number, account_type, transfer_label) VALUES (?, ?, ?, ?, ?)')
    .run(category, fields.amount ?? null, fields.accountNumber ?? null, fields.accountType ?? null, fields.transferLabel ?? null)
  return listCategoryDestinations()
}

export function updateCategoryDestination(
  destId: number,
  fields: {
    amount?: number | null
    accountNumber?: string | null
    accountType?: string | null
    transferLabel?: string | null
  }
): CategoryRouting[] {
  const existing = getDb()
    .prepare('SELECT amount, account_number, account_type, transfer_label FROM category_destinations WHERE id = ?')
    .get(destId) as CatDestRow | undefined
  if (!existing) return listCategoryDestinations()

  getDb()
    .prepare('UPDATE category_destinations SET amount = ?, account_number = ?, account_type = ?, transfer_label = ? WHERE id = ?')
    .run(
      fields.amount !== undefined ? fields.amount : existing.amount,
      fields.accountNumber !== undefined ? fields.accountNumber : existing.account_number,
      fields.accountType !== undefined ? fields.accountType : existing.account_type,
      fields.transferLabel !== undefined ? fields.transferLabel : existing.transfer_label,
      destId
    )
  return listCategoryDestinations()
}

export function removeCategoryDestination(destId: number): CategoryRouting[] {
  getDb().prepare('DELETE FROM category_destinations WHERE id = ?').run(destId)
  return listCategoryDestinations()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
