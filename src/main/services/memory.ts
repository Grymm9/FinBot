import { getDb } from '../db'
import { isAiConfigured } from './ai-config'
import { getSetting, setSetting } from './settings'
import { recordFail, recordOk } from './health'
import { quickChat } from './llm'
import type { ConversationEntry, Memory, MemoryKind, MemorySearchResult } from '@shared/types'

/**
 * Long-term memory for FinanceBot.
 *
 * Three tiers:
 *  1. Rolling window  – `recentConversationMessages()` returns the last N turns
 *     from a single merged timeline (in-app + Discord) for the prompt.
 *  2. Distilled facts – the `memories` table, written explicitly by the user/AI
 *     (`save_memory`) or by the background distillation pass.
 *  3. On-demand recall – `searchMemory()` searches both memories and the full
 *     conversation log, exposed to the AI as the `search_memory` tool.
 *
 * Money is deliberately NOT remembered: balances, budgets and transaction
 * amounts are always read live from the database.
 */

const MAX_CONTENT = 400
const MIN_DISTILL_MESSAGES = 6
const DISTILL_TRANSCRIPT_CHARS = 12_000
const CONTEXT_MEMORY_LIMIT = 40
const WINDOW_MESSAGES = 24

interface MemoryRow {
  id: number
  kind: string
  content: string
  source: string
  pinned: number
  created_at: number | null
  updated_at: number | null
}

const KINDS: MemoryKind[] = ['fact', 'preference', 'note', 'summary']

function normaliseKind(kind: unknown): MemoryKind {
  const k = String(kind ?? '').toLowerCase()
  return (KINDS as string[]).includes(k) ? (k as MemoryKind) : 'fact'
}

function mapRow(r: MemoryRow): Memory {
  return {
    id: r.id,
    kind: normaliseKind(r.kind),
    content: r.content,
    source: r.source || 'app',
    pinned: r.pinned === 1,
    createdAt: r.created_at ?? 0,
    updatedAt: r.updated_at ?? r.created_at ?? 0
  }
}

const normaliseText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(the|a|an|user|they|their)\s+/, '')
    .trim()

function tokens(s: string): Set<string> {
  return new Set(normaliseText(s).split(' ').filter((t) => t.length > 2))
}

function similarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.max(ta.size, tb.size)
}

/** Reject distilled facts that are really volatile financial figures. */
function looksLikeVolatileMoney(content: string): boolean {
  return /\$\s?\d|\b\d[\d,]*(\.\d{2})?\s*(dollars?|nzd)\b/i.test(content)
}

export function listMemories(): Memory[] {
  const rows = getDb()
    .prepare(
      'SELECT id, kind, content, source, pinned, created_at, updated_at FROM memories ORDER BY pinned DESC, updated_at DESC, id DESC'
    )
    .all() as MemoryRow[]
  return rows.map(mapRow)
}

export function getMemory(id: number): Memory | null {
  const row = getDb()
    .prepare('SELECT id, kind, content, source, pinned, created_at, updated_at FROM memories WHERE id = ?')
    .get(id) as MemoryRow | undefined
  return row ? mapRow(row) : null
}

/**
 * Store a memory. Near-duplicates are folded into the existing entry (its text
 * is refreshed and `updated_at` bumped) so the list does not accumulate
 * reworded versions of the same fact.
 */
export function createMemory(
  content: string,
  kind: MemoryKind | string = 'fact',
  source = 'app',
  pinned = false
): Memory | null {
  const text = content.trim().slice(0, MAX_CONTENT)
  if (!text) return null
  const db = getDb()
  const now = Date.now()

  const existing = listMemories().find((m) => similarity(m.content, text) >= 0.8)
  if (existing) {
    db.prepare('UPDATE memories SET content = ?, kind = ?, updated_at = ? WHERE id = ?').run(
      text,
      normaliseKind(kind),
      now,
      existing.id
    )
    return getMemory(existing.id)
  }

  const info = db
    .prepare('INSERT INTO memories (kind, content, source, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(normaliseKind(kind), text, source, pinned ? 1 : 0, now, now)
  return getMemory(Number(info.lastInsertRowid))
}

export function updateMemory(
  id: number,
  fields: { content?: string; kind?: string; pinned?: boolean }
): Memory | null {
  const db = getDb()
  const before = getMemory(id)
  if (!before) return null
  const content = fields.content !== undefined ? fields.content.trim().slice(0, MAX_CONTENT) : before.content
  if (!content) return null
  db.prepare('UPDATE memories SET content = ?, kind = ?, pinned = ?, updated_at = ? WHERE id = ?').run(
    content,
    fields.kind !== undefined ? normaliseKind(fields.kind) : before.kind,
    fields.pinned !== undefined ? (fields.pinned ? 1 : 0) : before.pinned ? 1 : 0,
    Date.now(),
    id
  )
  return getMemory(id)
}

export function deleteMemory(id: number): boolean {
  const info = getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
  return info.changes > 0
}

// ---------------------------------------------------------------------------
// Conversation window (one merged timeline for app + Discord)
// ---------------------------------------------------------------------------

/** The tail of the conversation, ready to splice into the message array. */
export function recentConversationMessages(
  limit = WINDOW_MESSAGES
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const rows = getDb()
    .prepare(
      `SELECT channel, role, content FROM chat_logs
       WHERE role IN ('user', 'assistant') AND content NOT LIKE '[error]%'
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(limit) as Array<{ channel: string; role: string; content: string }>

  return rows.reverse().map((r) => ({
    role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: r.channel === 'discord' && r.role === 'user' ? `[via Discord] ${r.content}` : r.content
  }))
}

/** Raw conversation rows for the Memory page. */
export function listConversations(limit = 60): ConversationEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, channel, role, content, created_at FROM chat_logs
       WHERE role IN ('user', 'assistant') AND content NOT LIKE '[error]%'
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(limit) as Array<{ id: number; channel: string; role: string; content: string; created_at: number | null }>

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel === 'discord' ? ('discord' as const) : ('app' as const),
    role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: r.content,
    createdAt: r.created_at ?? 0
  }))
}

export function recordConversation(
  channel: 'app' | 'discord',
  role: 'user' | 'assistant',
  content: string
): void {
  getDb()
    .prepare('INSERT INTO chat_logs (role, content, created_at, channel) VALUES (?, ?, ?, ?)')
    .run(role, content, Date.now(), channel)
}

// ---------------------------------------------------------------------------
// Prompt block
// ---------------------------------------------------------------------------

/** Formatted memory block injected into the system prompt. */
export function memoryBlock(): string {
  const all = listMemories()
  if (all.length === 0) {
    return [
      '<memory>',
      'You have no stored long-term memories about this user yet.',
      'When you learn something durable (a preference, a personal circumstance, how they like to be advised), call save_memory.',
      'Never store balances, transaction amounts, budget figures or other money numbers as memories — read those live from <financial_context>.',
      '</memory>'
    ].join('\n')
  }

  const pinned = all.filter((m) => m.pinned)
  const rest = all.filter((m) => !m.pinned).slice(0, Math.max(0, CONTEXT_MEMORY_LIMIT - pinned.length))
  const line = (m: Memory): string => `- (${m.kind}) ${m.content}`

  return [
    '<memory>',
    'Durable things you remember about the user and earlier conversations with them.',
    'Live numbers in <financial_context> always win if a memory disagrees. Never invent memories.',
    ...(pinned.length ? ['Pinned:', ...pinned.map(line)] : []),
    ...(rest.length ? ['Remembered:', ...rest.map(line)] : []),
    '',
    'Use save_memory to add a new durable fact, update_memory to correct one, and search_memory to recall older conversations.',
    'Do not store balances, transaction amounts or budget figures as memories — those are read live.',
    '</memory>'
  ].join('\n')
}

/** Compact list for the financial context JSON. */
export function memoriesForContext(): Array<{ id: number; kind: string; content: string; pinned: boolean }> {
  return listMemories()
    .slice(0, 60)
    .map((m) => ({ id: m.id, kind: m.kind, content: m.content, pinned: m.pinned }))
}

// ---------------------------------------------------------------------------
// Search (memories + full conversation history)
// ---------------------------------------------------------------------------

export function searchMemory(query: string, limit = 20): MemorySearchResult {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length > 1)
  if (terms.length === 0) return { memories: [], conversations: [] }

  const mems = listMemories()
    .map((m) => {
      const hay = m.content.toLowerCase()
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0)
      return { m, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt)
    .slice(0, limit)
    .map((x) => x.m)

  // Scan a generous slice of history rather than all of it; this is a local
  // personal app, so a few thousand rows is still instant.
  const rows = getDb()
    .prepare(
      `SELECT id, channel, role, content, created_at FROM chat_logs
       WHERE role IN ('user', 'assistant') AND content NOT LIKE '[error]%'
       ORDER BY created_at DESC, id DESC LIMIT 2000`
    )
    .all() as Array<{ id: number; channel: string; role: string; content: string; created_at: number | null }>

  const conversations = rows
    .map((r) => {
      const hay = r.content.toLowerCase()
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0)
      return { r, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.r.created_at ?? 0) - (a.r.created_at ?? 0))
    .slice(0, limit)
    .map((x) => ({
      id: x.r.id,
      channel: x.r.channel === 'discord' ? ('discord' as const) : ('app' as const),
      role: x.r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: x.r.content,
      createdAt: x.r.created_at ?? 0
    }))

  return { memories: mems, conversations }
}

// ---------------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------------

/**
 * Fold the conversation since the last pass into durable memories using the
 * fast model. Returns the number of new memories stored.
 */
export async function distillMemories(force = false): Promise<number> {
  const db = getDb()
  const cursor = Number(getSetting('memory_distilled_upto') || '0')

  const rows = db
    .prepare(
      `SELECT id, channel, role, content FROM chat_logs
       WHERE id > ? AND role IN ('user', 'assistant') AND content NOT LIKE '[error]%'
       ORDER BY id ASC LIMIT 200`
    )
    .all(cursor) as Array<{ id: number; channel: string; role: string; content: string }>

  if (rows.length === 0) return 0
  if (!force && rows.length < MIN_DISTILL_MESSAGES) return 0

  let transcript = rows
    .map((r) => {
      const who = r.role === 'assistant' ? 'Assistant' : r.channel === 'discord' ? 'User (Discord)' : 'User'
      return `${who}: ${r.content}`
    })
    .join('\n')
  if (transcript.length > DISTILL_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-DISTILL_TRANSCRIPT_CHARS)
  }

  const existing = listMemories()
    .slice(0, 120)
    .map((m) => `- ${m.content}`)
    .join('\n')

  const raw = await quickChat([
    {
      role: 'system',
      content: [
        'You extract long-term memories from a conversation between a user and their personal-finance assistant.',
        'Return ONLY a JSON array (possibly empty). Each item: {"content": string, "kind": "fact"|"preference"|"note"}.',
        'Rules:',
        '- Only durable information that will still matter in months: preferences, personal circumstances, goals, constraints, how they like to be advised, recurring commitments.',
        '- Never store balances, transaction amounts, budget figures, prices or any other money number.',
        '- Never store one-off questions, small talk, or anything the assistant said about itself.',
        '- Do not repeat or rephrase items already remembered.',
        '- Max 6 items. Each content must be a single short sentence under 25 words, written in the third person (e.g. "Prefers ...").',
        '- If nothing is worth remembering, return [].'
      ].join('\n')
    },
    {
      role: 'user',
      content: `Already remembered:\n${existing || '(nothing)'}\n\nConversation:\n${transcript}`
    }
  ])

  let added = 0
  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Array<{ content?: string; kind?: string }>
      for (const item of parsed.slice(0, 6)) {
        const content = String(item?.content ?? '').trim()
        if (!content || content.length < 4) continue
        if (looksLikeVolatileMoney(content)) continue
        if (listMemories().some((m) => similarity(m.content, content) >= 0.75)) continue
        if (createMemory(content, normaliseKind(item?.kind), 'distilled')) added++
      }
    } catch {
      // Malformed JSON – skip this pass but still advance the cursor so a bad
      // batch doesn't get retried forever.
    }
  }

  const lastId = rows[rows.length - 1].id
  setSetting('memory_distilled_upto', String(lastId))
  return added
}

/** Distil periodically so memory keeps up without the user asking. */
export function startMemoryScheduler(): NodeJS.Timeout {
  const run = (): void => {
    if (!isAiConfigured()) return
    distillMemories()
      .then(() => recordOk('memory'))
      .catch((e) => recordFail('memory', e))
  }
  setTimeout(run, 60_000)
  return setInterval(run, 10 * 60_000)
}
