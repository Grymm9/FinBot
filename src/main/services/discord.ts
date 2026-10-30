import { getSetting } from './settings'
import { getDb } from '../db'
import { rememberThread } from './discord-threads'

interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
}

export interface BotMessageResult {
  ok: boolean
  messageId?: string
}

export interface DiscordThreadSummary {
  id: string
  name?: string
  parent_id?: string
  owner_id?: string
  thread_metadata?: { archived?: boolean; auto_archive_duration?: number }
}

const API = 'https://discord.com/api/v10'
const THREAD_ARCHIVE_MINUTES = 10_080 // 7 days, so a conversation can continue

/**
 * POST a Discord webhook message. Returns true on success (2xx response).
 * Throws when no webhook URL is configured.
 */
export async function sendDiscordMessage(
  content: string,
  embeds: DiscordEmbed[] = []
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = getSetting('DISCORD_WEBHOOK_URL')
  if (!url) {
    throw new Error('Discord webhook URL is not configured. Set DISCORD_WEBHOOK_URL.')
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'FinanceBot', content, embeds })
  })

  const body = await res.text().catch(() => '')
  const ok = res.status >= 200 && res.status < 300
  logAlert(ok)
  return { ok, status: res.status, body }
}

function logAlert(success: boolean): void {
  try {
    getDb()
      .prepare('INSERT INTO alert_log (type, message, sent_at, success) VALUES (?, ?, ?, ?)')
      .run('discord', 'Discord webhook sent', Date.now(), success ? 1 : 0)
  } catch {
    // best-effort logging
  }
}

/**
 * Post with the bot account (required for thread replies). Returns the new
 * message id when Discord accepts it.
 */
export async function sendBotMessage(channelId: string, content: string): Promise<BotMessageResult> {
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) return { ok: false }
  try {
    const res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 2000) })
    })
    if (!res.ok) return { ok: false }
    const json = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, messageId: json?.id }
  } catch {
    return { ok: false }
  }
}

/** Unarchive a thread so a late reply can still be delivered. */
async function unarchiveThread(channelId: string): Promise<boolean> {
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) return false
  try {
    const res = await fetch(`${API}/channels/${channelId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false })
    })
    return res.ok
  } catch {
    return false
  }
}

let cachedBotUserId: string | null = null

/** The bot's own user id, used to recognise its threads. Cached per launch. */
export async function getBotUserId(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) return null
  try {
    const res = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bot ${token}` } })
    if (!res.ok) return null
    const json = (await res.json().catch(() => null)) as { id?: string } | null
    cachedBotUserId = json?.id ?? null
    return cachedBotUserId
  } catch {
    return null
  }
}

async function listThreadsFrom(path: string): Promise<DiscordThreadSummary[]> {
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) return []
  try {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } })
    if (!res.ok) return []
    const json = (await res.json().catch(() => null)) as { threads?: DiscordThreadSummary[] } | null
    return Array.isArray(json?.threads) ? (json?.threads ?? []) : []
  } catch {
    return []
  }
}

/** Active threads in a channel (threads created in the last archive window). */
export function listActiveThreads(channelId: string): Promise<DiscordThreadSummary[]> {
  return listThreadsFrom(`/channels/${channelId}/threads/active`)
}

/** Recently archived public threads, so older conversations can be resumed. */
export function listArchivedThreads(channelId: string): Promise<DiscordThreadSummary[]> {
  return listThreadsFrom(`/channels/${channelId}/threads/archived/public?limit=50`)
}

/** Create a public thread on a message and return its channel id. */
async function createThread(channelId: string, messageId: string, name: string): Promise<string | null> {
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) return null
  const safeName = name.replace(/\s+/g, ' ').trim().slice(0, 90) || 'FinanceBot'
  try {
    const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName, auto_archive_duration: THREAD_ARCHIVE_MINUTES })
    })
    if (!res.ok) return null
    const json = (await res.json()) as { id?: string }
    return json.id ?? null
  } catch {
    return null
  }
}

/**
 * Reply to a Discord message inside a thread started on that message, so the
 * channel doesn't fill up with bot chatter. Falls back to a plain channel
 * message (or the webhook) when threading is unavailable.
 */
export async function replyToDiscordMessage(
  channelId: string,
  messageId: string,
  content: string,
  threadName: string
): Promise<boolean> {
  const configured = getSetting('DISCORD_CHANNEL_ID')
  const useThreads = getSetting('DISCORD_USE_THREADS', '1') !== '0'

  // Already inside a thread — just answer there. If the thread auto-archived,
  // unarchive it and retry once.
  if (useThreads && configured && channelId !== configured) {
    const direct = await sendBotMessage(channelId, content)
    if (direct.ok) return true
    if (await unarchiveThread(channelId)) {
      return (await sendBotMessage(channelId, content)).ok
    }
    return false
  }

  if (useThreads) {
    const threadId = await createThread(channelId, messageId, threadName)
    if (threadId) {
      const sent = await sendBotMessage(threadId, content)
      if (sent.ok) {
        // Remember the thread and start its cursor at our reply, so the next
        // user message inside it is picked up (and old history is not replayed).
        rememberThread(threadId, channelId, threadName, sent.messageId ?? null)
        return true
      }
    }
  }

  if ((await sendBotMessage(channelId, content)).ok) return true
  // Last resort: webhook (works without bot permissions).
  try {
    const r = await sendDiscordMessage(content)
    return r.ok
  } catch {
    return false
  }
}

export async function testDiscord(): Promise<{ ok: boolean; message: string }> {
  const url = getSetting('DISCORD_WEBHOOK_URL')
  if (!url) {
    return { ok: false, message: 'No webhook configured. Add DISCORD_WEBHOOK_URL in Settings or .env.' }
  }
  try {
    const r = await sendDiscordMessage('✅ FinanceBot test alert — Discord integration is working.', [
      { title: 'FinanceBot', description: 'Your phone alerts are live.', color: 0x22d3aa }
    ])
    return { ok: r.ok, message: r.ok ? 'Test message sent successfully.' : `Discord returned HTTP ${r.status}.` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
