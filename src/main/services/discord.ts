import { getSetting } from './settings'
import { getDb } from '../db'

interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
}

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
 * Post with the bot account (required for thread replies). Returns false when
 * no bot token is configured or Discord rejects the request.
 */
export async function sendBotMessage(channelId: string, content: string): Promise<boolean> {
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) return false
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 2000) })
    })
    return res.ok
  } catch {
    return false
  }
}

/** Create a public thread on a message and return its channel id. */
async function createThread(channelId: string, messageId: string, name: string): Promise<string | null> {
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) return null
  const safeName = name.replace(/\s+/g, ' ').trim().slice(0, 90) || 'FinanceBot'
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName, auto_archive_duration: 1440 })
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

  // Already inside a thread — just answer there.
  if (useThreads && configured && channelId !== configured) {
    return sendBotMessage(channelId, content)
  }

  if (useThreads) {
    const threadId = await createThread(channelId, messageId, threadName)
    if (threadId) return sendBotMessage(threadId, content)
  }

  if (await sendBotMessage(channelId, content)) return true
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
