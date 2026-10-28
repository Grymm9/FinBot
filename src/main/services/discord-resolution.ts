import { getSetting, setSetting } from './settings'
import { recordFail, recordOk } from './health'
import { sendDiscordMessage, replyToDiscordMessage } from './discord'
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

/** Ask the AI about a Discord message and answer inside a thread on it. */
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

/**
 * Poll the configured Discord channel for new messages. Uncategorised-mapping
 * replies ("N Category") are applied as rules; everything else is passed to the
 * AI, which can read the financial context and make changes via its tools, and
 * its reply is posted back to the channel.
 */
export async function processDiscordReplies(): Promise<{ processed: number; replied: number; error?: string }> {
  const botToken = getSetting('DISCORD_BOT_TOKEN')
  const channelId = getSetting('DISCORD_CHANNEL_ID')
  if (!botToken || !channelId) {
    return { processed: 0, replied: 0, error: 'Discord bot token / channel ID not configured.' }
  }

  const lastId = getSetting('discord_last_message_id')
  const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=20${lastId ? '&after=' + lastId : ''}`

  let messages: DiscordMessage[]
  try {
    const res = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } })
    if (!res.ok) return { processed: 0, replied: 0, error: `Discord fetch failed (HTTP ${res.status})` }
    messages = (await res.json()) as DiscordMessage[]
  } catch (e) {
    return { processed: 0, replied: 0, error: (e as Error).message }
  }

  if (messages.length === 0) return { processed: 0, replied: 0 }

  // On the very first poll just record the latest message id and don't reply
  // to channel history.
  const newestId = messages[0].id
  if (!lastId) {
    setSetting('discord_last_message_id', newestId)
    return { processed: 0, replied: 0 }
  }

  // Skip the bot's own messages (webhook "FinanceBot" or any bot account).
  const incoming = messages.filter((m) => !m.author?.bot && (m.author?.username ?? '') !== 'FinanceBot')

  let processed = 0
  let replied = 0

  // Discord returns newest-first; process oldest-first.
  for (const msg of [...incoming].reverse()) {
    const content = (msg.content ?? '').trim()
    if (!content) continue

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

  setSetting('discord_last_message_id', newestId)
  return { processed, replied }
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
