import { getDb } from '../db'
import type { ManualAsset } from '@shared/types'

export function listManualAssets(): ManualAsset[] {
  return getDb()
    .prepare('SELECT id, name, amount FROM manual_assets ORDER BY name COLLATE NOCASE')
    .all() as ManualAsset[]
}

export function addManualAsset(name: string, amount: number): ManualAsset[] {
  getDb()
    .prepare('INSERT INTO manual_assets (name, amount, created_at) VALUES (?, ?, ?)')
    .run(name, amount, Date.now())
  return listManualAssets()
}

export function updateManualAsset(
  id: number,
  fields: { name?: string; amount?: number }
): ManualAsset[] {
  const db = getDb()
  const existing = db
    .prepare('SELECT name, amount FROM manual_assets WHERE id = ?')
    .get(id) as { name: string; amount: number } | undefined
  if (!existing) return listManualAssets()

  db.prepare('UPDATE manual_assets SET name = ?, amount = ? WHERE id = ?').run(
    fields.name ?? existing.name,
    fields.amount ?? existing.amount,
    id
  )
  return listManualAssets()
}

export function removeManualAsset(id: number): ManualAsset[] {
  getDb().prepare('DELETE FROM manual_assets WHERE id = ?').run(id)
  return listManualAssets()
}
