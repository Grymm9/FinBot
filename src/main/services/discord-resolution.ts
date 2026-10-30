import { BrowserWindow } from 'electron'
import { getSetting, setSetting } from './settings'
import { recordFail, recordOk } from './health'
import {
  getBotUserId,
  listActiveThreads,
  listArchivedThreads,
  replyToDiscordMessage,
  sendDiscordMessage
} from './discord'
import { forgetThread, listThreads, rememberThread, setThreadCursor } from './discord-threads'
import { listUnmatchedTransactions, addRule } from './budget'
import { buildFinancialContext } from './context'
import { streamChat, baseSystemPrompt } from './deepseek'
import { memoryBlock, recentConversationMessages, recordConversation } from './memory'

interface PendingTx {
  id: string
  description: string
  merchant: string | null
}

interface DiscordMessage {
  id: string
  channel_id?: string
  content: string
  author?: { id?: string; bot?: boolean; username?: string }
}

const API = 'https://discord.com/api/v10'
const PAGE_LIMIT = 100

/** Snowflake ids are numeric strings; compare them as numbers. */
function compareIds(a: string, b: string): number {
  try {
    const x = BigInt(a)
    const y = BigInt(b)
    return x < y ? -1 : x > y ? 1 : 0
  } catch {
    return a.localeCompare(b)
  }
}

function isFromBot(m: DiscordMessage): boolean {
  return !!m.author?.bot || (m.author?.username ?? '') === 'FinanceBot'
}

/** Send a numbered list of uncategorised transactions to Discord for the user to map. */
export async function notifyUncategorized(): Promise<{ count: number }> {
  const txs = listUnmatchedTransactions(10)
  if (txs.length === 0) return { count: 0 }

  const lines = txs
    .map((t, i) => `${i + 1}. $${Math.abs(t.amount).toFixed(2)} — ${t.description} (${t.date})`)
    .join('\n')
  try {
    await sendDiscordMessage(
      `❓ **Uncategorized transactions** this cycle — reply with "N Category" to map them:\n${lines}`
    )
  } catch (e) {
    console.error('Discord notify failed:', e)
    return { count: 0 }
  }

  const pending: PendingTx[] = txs.map((t) => ({
    id: t.id,
    description: t.description,
    merchant: t.merchant
  }))
  setSetting('discord_pending_txs', JSON.stringify(pending))
  return { count: txs.length }
}

/**
 * Try to interpret a message as an "N Category" uncategorised-mapping reply.
 * Returns true if a mapping rule was applied.
 */
function applyMappingReply(content: string): boolean {
  let pending: PendingTx[] = []
  try {
    pending = JSON.parse(getSetting('discord_pending_txs') || '[]')
  } catch {
    pending = []
  }
  if (pending.length === 0) return false

  let applied = false
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*(?:->|:|-)?\s*([A-Za-z][A-Za-z0-9 &'-]{1,40})\s*$/)
    if (!m) continue
    const idx = Number(m[1]) - 1
    const category = m[2].trim()
    const tx = pending[idx]
    if (!tx) continue
    const keyword = tx.merchant ?? tx.description.split(/\s+/).slice(0, 3).join(' ')
    addRule(keyword, category)
    applied = true
  }
  if (applied) setSetting('discord_pending_txs', '[]')
  return applied
}

/** Ask the AI about a Discord message and answer in the same channel/thread. */
async function replyToDiscord(msg: DiscordMessage): Promise<void> {
  const content = (msg.content ?? '').trim()
  const context = buildFinancialContext()
  const reply = await streamChat({
    messages: [
      { role: 'system', content: baseSystemPrompt() },
      { role: 'system', content: memoryBlock() },
      { role: 'system', content: `<financial_context>\n${context}\n</financial_context>` },
      // Shared timeline: this includes what was said in the app as well.
      ...recentConversationMessages().map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: `[via Discord] ${content}` }
    ],
    onToken: () => {}
  })
  const text = reply.content.trim()

  // Persist into the single unified timeline so both surfaces share memory.
  recordConversation('discord', 'user', content)
  if (text) recordConversation('discord', 'assistant', text)

  if (!text) return
  const channelId = msg.channel_id ?? getSetting('DISCORD_CHANNEL_ID')
  await replyToDiscordMessage(channelId, msg.id, text, `FinanceBot · ${content.slice(0, 50)}`)
}

/** Fetch messages newer than `after` (or the latest page when omitted). */
async function fetchMessages(channelId: string, after?: string): Promise<DiscordMessage[]> {
  const token = getSetting('DISCORD_BOT_TOKEN')
  if (!token) throw new Error('Discord bot token is not configured.')
  const query = `?limit=${PAGE_LIMIT}${after ? `&after=${after}` : ''}`
  const res = await fetch(`${API}/channels/${channelId}/messages${query}`, {
    headers: { Authorization: `Bot ${token}` }
  })
  if (!res.ok) {
    const error = new Error(`Discord fetch failed (HTTP ${res.status})`) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  const batch = (await res.json().catch(() => [])) as DiscordMessage[]
  if (!Array.isArray(batch)) return []
  return [...batch].sort((a, b) => compareIds(a.id, b.id))
}

interface PollResult {
  processed: number
  replied: number
  newestId?: string
}

/**
 * Poll one channel/thread. With no cursor, the newest message is recorded
 * without replying, so enabling this on an existing server never answers
 * old history.
 */
async function pollChannel(channelId: string, cursor: string | undefined): Promise<PollResult> {
  const messages = await fetchMessages(channelId, cursor)
  if (messages.length === 0) return { processed: 0, replied: 0 }

  const newestId = messages[messages.length - 1].id
  if (!cursor) return { processed: 0, replied: 0, newestId }

  let processed = 0
  let replied = 0
  for (const msg of messages) {
    const content = (msg.content ?? '').trim()
    if (!content || isFromBot(msg)) continue

    if (applyMappingReply(content)) {
      processed++
      continue
    }

    try {
      await replyToDiscord(msg)
      replied++
    } catch (e) {
      console.error('Discord AI reply failed:', e)
    }
  }
  return { processed, replied, newestId }
}

/**
 * Find threads owned by this bot (active and recently archived) and start
 * tracking them. Threads created by older versions of FinanceBot were not
 * persisted, so discovery is what makes them resumable after an upgrade.
 */
async function discoverThreads(parentChannelId: string): Promise<void> {
  const botId = await getBotUserId()
  const [active, archived] = await Promise.all([
    listActiveThreads(parentChannelId),
    listArchivedThreads(parentChannelId)
  ])

  for (const thread of [...active, ...archived]) {
    if (thread.parent_id && thread.parent_id !== parentChannelId) continue
    // Bot-created threads are owned by the bot; older ones are also recognised
    // by the "FinanceBot · …" naming convention.
    const owned = thread.owner_id === botId || (thread.name ?? '').startsWith('FinanceBot')
    if (!owned) continue
    // `null` cursor: the first poll records the newest id and skips history.
    rememberThread(thread.id, parentChannelId, thread.name ?? '', null)
  }
}

let running = false

/**
 * Poll the configured Discord channel and every FinanceBot thread for new
 * messages. Messages are passed to the AI, which can read the financial
 * context and make changes via its tools; replies stay in the thread the
 * conversation came from.
 */
export async function processDiscordReplies(): Promise<{
  processed: number
  replied: number
  error?: string
}> {
  if (running) return { processed: 0, replied: 0 }

  const botToken = getSetting('DISCORD_BOT_TOKEN')
  const channelId = getSetting('DISCORD_CHANNEL_ID')
  if (!botToken || !channelId) {
    return { processed: 0, replied: 0, error: 'Discord bot token / channel ID not configured.' }
  }

  running = true
  try {
    await discoverThreads(channelId)

    let processed = 0
    let replied = 0
    let error: string | undefined

    // Parent channel (new questions, uncategorised mapping replies).
    const parentCursor = getSetting('discord_last_message_id') || undefined
    try {
      const parent = await pollChannel(channelId, parentCursor)
      processed += parent.processed
      replied += parent.replied
      if (parent.newestId) setSetting('discord_last_message_id', parent.newestId)
    } catch (e) {
      error = (e as Error).message
    }

    // Threads (continuations of earlier answers).
    for (const thread of listThreads(channelId)) {
      try {
        const result = await pollChannel(thread.threadId, thread.lastMessageId ?? undefined)
        processed += result.processed
        replied += result.replied
        if (result.newestId) setThreadCursor(thread.threadId, result.newestId)
      } catch (e) {
        const status = (e as Error & { status?: number }).status
        // Deleted or inaccessible threads would otherwise be retried forever.
        if (status === 404 || status === 403) forgetThread(thread.threadId)
      }
    }

    // Let an open AI Advisor panel pull the new Discord messages immediately.
    if (processed + replied > 0) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('chat:changed')
      }
    }

    return { processed, replied, error }
  } finally {
    running = false
  }
}

/** Poll periodically for new Discord messages and reply to them. */
export function startDiscordScheduler(): NodeJS.Timeout {
  const run = (): void => {
    if (!getSetting('DISCORD_BOT_TOKEN') || !getSetting('DISCORD_CHANNEL_ID')) return
    processDiscordReplies()
      .then((r) => (r.error ? recordFail('discord', r.error) : recordOk('discord')))
      .catch((e) => recordFail('discord', e))
  }
  setTimeout(run, 5_000)
  return setInterval(run, 30_000)
}
