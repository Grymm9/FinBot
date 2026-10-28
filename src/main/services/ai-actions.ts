import { getDb } from '../db'
import type { AiAction } from '@shared/types'

/**
 * Audit trail and undo for AI writes.
 *
 * The model can change budget allocations, category rules, card mappings,
 * reminders, memories and goals. Before this existed those changes were
 * untraceable and irreversible. Every mutating tool now stores the row as it
 * was, and the chat shows an Undo button for the actions of that turn.
 */

export type UndoDescriptor =
  | { kind: 'category'; key: string; row: Record<string, unknown> | null }
  | { kind: 'rule'; key: number; row: Record<string, unknown> | null }
  | { kind: 'card'; key: string; row: Record<string, unknown> | null }
  | { kind: 'reminder'; key: number; row: Record<string, unknown> | null }
  | { kind: 'memory'; key: number; row: Record<string, unknown> | null }
  | { kind: 'goal'; key: number; row: Record<string, unknown> | null }
  | { kind: 'none' }

export function logAction(entry: {
  tool: string
  summary: string
  args: Record<string, unknown>
  undo: UndoDescriptor
}): number {
  const info = getDb()
    .prepare('INSERT INTO ai_actions (tool, summary, args, undo, undone, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(entry.tool, entry.summary, JSON.stringify(entry.args), JSON.stringify(entry.undo), Date.now())
  return Number(info.lastInsertRowid)
}

export function listActions(limit = 30): AiAction[] {
  const rows = getDb()
    .prepare('SELECT id, tool, summary, args, undone, created_at FROM ai_actions ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<{
    id: number
    tool: string
    summary: string | null
    args: string | null
    undone: number
    created_at: number
  }>

  return rows.map((r) => ({
    id: r.id,
    tool: r.tool,
    summary: r.summary ?? '',
    args: parseJson(r.args),
    undone: r.undone === 1,
    createdAt: r.created_at
  }))
}

export function undoAction(id: number): { ok: boolean; message: string } {
  const db = getDb()
  const row = db.prepare('SELECT undo, undone FROM ai_actions WHERE id = ?').get(id) as
    | { undo: string | null; undone: number }
    | undefined
  if (!row) return { ok: false, message: `No action #${id}.` }
  if (row.undone === 1) return { ok: false, message: `Action #${id} was already undone.` }

  let undo: UndoDescriptor
  try {
    undo = JSON.parse(row.undo ?? '{"kind":"none"}') as UndoDescriptor
  } catch {
    return { ok: false, message: 'This action has no undo information.' }
  }

  try {
    const message = applyUndo(undo)
    db.prepare('UPDATE ai_actions SET undone = 1 WHERE id = ?').run(id)
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

function applyUndo(undo: UndoDescriptor): string {
  const db = getDb()

  switch (undo.kind) {
    case 'none':
      return 'Nothing to undo for this action.'

    case 'category':
      if (!undo.row) {
        db.prepare('DELETE FROM categories WHERE name = ?').run(undo.key)
        return `Removed the category "${undo.key}".`
      }
      db.prepare(
        `INSERT INTO categories (name, amount, frequency, color, split, active_from)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           amount = excluded.amount, frequency = excluded.frequency, color = excluded.color,
           split = excluded.split, active_from = excluded.active_from`
      ).run(
        undo.key,
        Number(undo.row.amount ?? 0),
        String(undo.row.frequency ?? 'monthly'),
        (undo.row.color as string | null) ?? null,
        Number(undo.row.split ?? 0),
        (undo.row.active_from as string | null) ?? null
      )
      return `Restored "${undo.key}" to $${Number(undo.row.amount ?? 0).toFixed(2)}.`

    case 'rule':
      db.prepare('DELETE FROM category_rules WHERE id = ?').run(undo.key)
      if (undo.row) {
        db.prepare(
          'INSERT OR REPLACE INTO category_rules (id, keyword, category, created_at) VALUES (?, ?, ?, ?)'
        ).run(
          Number(undo.row.id ?? undo.key),
          String(undo.row.keyword ?? ''),
          String(undo.row.category ?? ''),
          Number(undo.row.created_at ?? Date.now())
        )
        return `Restored the previous rule for "${String(undo.row.keyword ?? '')}".`
      }
      return 'Removed the category rule.'

    case 'card':
      if (!undo.row) {
        db.prepare('DELETE FROM card_mappings WHERE card = ?').run(undo.key)
        return `Removed the mapping for card ${undo.key}.`
      }
      db.prepare(
        `INSERT INTO card_mappings (card, category, created_at) VALUES (?, ?, ?)
         ON CONFLICT(card) DO UPDATE SET category = excluded.category`
      ).run(undo.key, String(undo.row.category ?? ''), Number(undo.row.created_at ?? Date.now()))
      return `Restored card ${undo.key}.`

    case 'reminder':
      if (!undo.row) {
        db.prepare('DELETE FROM user_reminders WHERE id = ?').run(undo.key)
        return 'Removed the reminder.'
      }
      db.prepare(
        `INSERT OR REPLACE INTO user_reminders (id, message, target_date, repeat, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        undo.key,
        String(undo.row.message ?? ''),
        String(undo.row.target_date ?? ''),
        String(undo.row.repeat ?? 'none'),
        Number(undo.row.created_at ?? Date.now())
      )
      return 'Restored the reminder.'

    case 'memory':
      if (!undo.row) {
        db.prepare('DELETE FROM memories WHERE id = ?').run(undo.key)
        return 'Removed the memory.'
      }
      db.prepare(
        `INSERT OR REPLACE INTO memories (id, kind, content, source, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        undo.key,
        String(undo.row.kind ?? 'fact'),
        String(undo.row.content ?? ''),
        String(undo.row.source ?? 'ai'),
        Number(undo.row.pinned ?? 0),
        Number(undo.row.created_at ?? Date.now()),
        Number(undo.row.updated_at ?? Date.now())
      )
      return 'Restored the memory.'

    case 'goal':
      if (!undo.row) {
        db.prepare('DELETE FROM goals WHERE id = ?').run(undo.key)
        return 'Removed the goal.'
      }
      db.prepare(
        `INSERT OR REPLACE INTO goals (id, name, target_amount, saved_amount, target_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        undo.key,
        String(undo.row.name ?? ''),
        Number(undo.row.target_amount ?? 0),
        Number(undo.row.saved_amount ?? 0),
        (undo.row.target_date as string | null) ?? null,
        Number(undo.row.created_at ?? Date.now()),
        Number(undo.row.updated_at ?? Date.now())
      )
      return 'Restored the goal.'

    default:
      return 'Nothing to undo for this action.'
  }
}

// ---------------------------------------------------------------------------
// Snapshots (taken before a mutation)
// ---------------------------------------------------------------------------

export function snapshotCategory(name: string): Record<string, unknown> | null {
  return (
    (getDb()
      .prepare('SELECT name, amount, frequency, color, split, active_from FROM categories WHERE name = ?')
      .get(name) as Record<string, unknown> | undefined) ?? null
  )
}

export function snapshotCard(card: string): Record<string, unknown> | null {
  return (
    (getDb().prepare('SELECT card, category, created_at FROM card_mappings WHERE card = ?').get(card) as
      | Record<string, unknown>
      | undefined) ?? null
  )
}

export function snapshotReminder(id: number): Record<string, unknown> | null {
  return (
    (getDb()
      .prepare('SELECT id, message, target_date, repeat, created_at FROM user_reminders WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined) ?? null
  )
}

export function snapshotMemory(id: number): Record<string, unknown> | null {
  return (
    (getDb()
      .prepare('SELECT id, kind, content, source, pinned, created_at, updated_at FROM memories WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined) ?? null
  )
}

export function snapshotGoal(id: number): Record<string, unknown> | null {
  return (
    (getDb()
      .prepare('SELECT id, name, target_amount, saved_amount, target_date, created_at, updated_at FROM goals WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined) ?? null
  )
}

/** Most recent rule id for a keyword + category, created within the last few seconds. */
export function latestRuleId(keyword: string, category: string): number {
  const row = getDb()
    .prepare('SELECT id FROM category_rules WHERE keyword = ? AND category = ? ORDER BY id DESC LIMIT 1')
    .get(keyword, category) as { id: number } | undefined
  return row?.id ?? 0
}

/** The rule that existed for a normalised keyword before addRule replaced it. */
export function snapshotRuleByKeyword(keyword: string): Record<string, unknown> | null {
  const norm = keyword
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    (getDb()
      .prepare('SELECT id, keyword, category, created_at FROM category_rules WHERE keyword = ?')
      .get(norm) as Record<string, unknown> | undefined) ?? null
  )
}

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
