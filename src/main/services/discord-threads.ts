import { getDb } from '../db'

/**
 * Discord threads FinanceBot has joined (usually ones it created for a reply).
 *
 * Threads are separate Discord channels, so the parent-channel poller cannot
 * see replies inside them. Each tracked thread keeps its own message cursor so
 * a conversation can continue over many turns without re-answering history.
 */

export interface TrackedThread {
  threadId: string
  parentChannelId: string
  title: string
  lastMessageId: string | null
  createdAt: number
  updatedAt: number
}

interface ThreadRow {
  thread_id: string
  parent_channel_id: string
  title: string | null
  last_message_id: string | null
  created_at: number | null
  updated_at: number | null
}

const mapRow = (r: ThreadRow): TrackedThread => ({
  threadId: r.thread_id,
  parentChannelId: r.parent_channel_id,
  title: r.title ?? '',
  lastMessageId: r.last_message_id ?? null,
  createdAt: r.created_at ?? 0,
  updatedAt: r.updated_at ?? r.created_at ?? 0
})

/**
 * Start tracking a thread. An existing cursor is preserved, so discovering a
 * thread again never replays old messages.
 */
export function rememberThread(
  threadId: string,
  parentChannelId: string,
  title: string,
  lastMessageId: string | null
): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO discord_threads (thread_id, parent_channel_id, title, last_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         title = excluded.title,
         last_message_id = COALESCE(discord_threads.last_message_id, excluded.last_message_id),
         updated_at = excluded.updated_at`
    )
    .run(threadId, parentChannelId, title, lastMessageId, now, now)
}

export function listThreads(parentChannelId: string): TrackedThread[] {
  const rows = getDb()
    .prepare(
      `SELECT thread_id, parent_channel_id, title, last_message_id, created_at, updated_at
       FROM discord_threads WHERE parent_channel_id = ?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(parentChannelId) as ThreadRow[]
  return rows.map(mapRow)
}

export function getThread(threadId: string): TrackedThread | null {
  const row = getDb()
    .prepare(
      `SELECT thread_id, parent_channel_id, title, last_message_id, created_at, updated_at
       FROM discord_threads WHERE thread_id = ?`
    )
    .get(threadId) as ThreadRow | undefined
  return row ? mapRow(row) : null
}

/** Advance a thread's cursor after polling (or after posting a reply). */
export function setThreadCursor(threadId: string, messageId: string): void {
  getDb()
    .prepare('UPDATE discord_threads SET last_message_id = ?, updated_at = ? WHERE thread_id = ?')
    .run(messageId, Date.now(), threadId)
}

/** Stop polling a thread that was deleted or is no longer accessible. */
export function forgetThread(threadId: string): void {
  getDb().prepare('DELETE FROM discord_threads WHERE thread_id = ?').run(threadId)
}
