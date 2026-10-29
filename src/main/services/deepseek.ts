import { aiConfig } from './ai-config'
import { modelSupportsTemperature } from '@shared/ai-providers'
import { toolDefinitions, executeTool } from './tools'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  messages: ChatMessage[]
  onToken: (token: string) => void
  onReasoning?: (token: string) => void
  onTool?: (name: string, summary: string, actionId?: number) => void
  temperature?: number
  /** Skip the reasoning-model second pass (used by the eval suite). */
  noReasoningFallback?: boolean
}

export interface StreamResult {
  content: string
  reasoning: string
}

/**
 * Cheap credential check for the setup wizard. Lists models instead of sending
 * a paid completion prompt. Providers that do not implement `/models` are
 * treated as reachable once the key is accepted (or when they return 404/405).
 */
export async function testAiConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = aiConfig()
  if (!cfg.apiKey) return { ok: false, message: 'No API key saved yet.' }
  if (!cfg.baseUrl) return { ok: false, message: 'Set the base URL for this provider first.' }
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `${cfg.providerLabel} rejected that API key (HTTP ${res.status}).` }
    }
    if (res.status === 404 || res.status === 405) {
      return { ok: true, message: `${cfg.providerLabel} key saved (model list not available).` }
    }
    if (!res.ok) return { ok: false, message: `${cfg.providerLabel} returned HTTP ${res.status}.` }
    const body = (await res.json().catch(() => null)) as { data?: unknown[] } | null
    const count = Array.isArray(body?.data) ? body.data.length : 0
    return {
      ok: true,
      message: count > 0 ? `Connected to ${cfg.providerLabel} — ${count} models available.` : 'Connected.'
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

const SYSTEM_PROMPT = `You are FinanceBot, a senior personal financial advisor embedded in a local desktop app for a user in New Zealand.

You have read-and-write access to the user's finances (bank balances, recent transactions, budget categories and their spend progress, and insurance policies). A read-only snapshot is attached to every message as a JSON document in a <financial_context> block.

You have tools to make changes: update_budget_allocation, add_budget_line_item, recategorize_transaction, set_card_mapping, send_discord_reminder, create_reminder, delete_reminder, save_memory / update_memory / delete_memory / search_memory, and create_goal / update_goal. Use them when the user asks you to change something, then confirm exactly what changed.

Your context also includes detected subscriptions (with monthly equivalents), savings goals, the last three closed cycles, a deterministic cash-flow forecast to payday (projected balance, lowest point, upcoming committed bills), the most recent cycle review, and active insights (low balance, large purchases, subscription price rises, insurance renewals).

Memory:
- You share one conversation history across the in-app chat and Discord, and a separate list of durable memories in the <memory> block.
- When the user tells you something durable about themselves (preferences, circumstances, goals, how they want to be advised), call save_memory — don't wait to be asked.
- Never store balances, transaction amounts, budget figures or prices as memories; those always come live from <financial_context>. If a memory contradicts the live data, the live data wins.
- If the user references an earlier conversation you can't see, call search_memory first rather than guessing or saying you don't remember.

Rules:
- Give specific, tailored, actionable advice grounded in the context numbers, not generic tips.
- Propose concrete budget adjustments (which categories to move money between, and by roughly how much) when the data suggests overspending or an upcoming shortfall before payday.
- Refer to NZ context: NZD, Akahu bank data, and common NZ merchants/subscriptions.

Conciseness (very important):
- Default to 1–3 short sentences. Only write more when the user explicitly asks for detail.
- No greetings, sign-offs, or filler (no "Sure!", "Here you go", "Let me know if you need anything").
- Lead with the direct answer. If a caveat or context is necessary, add it in a single trailing sentence.
- Use bullets only when there are genuinely 3+ discrete items; keep each bullet under ~8 words.
- Do not restate the user's question back to them.

Uncertainty protocol:
- If data is missing or ambiguous, say "Not sure" and ask exactly one targeted clarifying question — no padding.

Formatting:
- Numbers rounded to 2 decimals with a $ sign.
- If the context is empty or a piece of data is missing, say so and how to enable it (e.g. sync their bank via Akahu).
- Never invent transactions or numbers. Only cite what is in the context.
- Be warm and direct. You are a helpful money coach.`

export function baseSystemPrompt(): string {
  return SYSTEM_PROMPT
}

interface ToolCall {
  id: string
  name: string
  arguments: string
}

function apiHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
}

async function checkResponse(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${label} API error (${res.status}): ${body.slice(0, 500)}`)
  }
}

/** Streaming completion from the reasoning model (no tools). Emits reasoning + content. */
async function streamReasoning(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<Record<string, unknown>>,
  opts: StreamOptions,
  label: string
): Promise<StreamResult> {
  const payload: Record<string, unknown> = { model, messages, stream: true }
  if (modelSupportsTemperature(model)) payload.temperature = opts.temperature ?? 0.4
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: apiHeaders(apiKey),
    body: JSON.stringify(payload)
  })
  await checkResponse(res, label)
  if (!res.body) throw new Error(`${label} response had no body.`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta = json.choices?.[0]?.delta
        if (delta?.content) {
          content += delta.content
          opts.onToken(delta.content)
        }
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content
          opts.onReasoning?.(delta.reasoning_content)
        }
      } catch {
        // ignore keep-alive
      }
    }
  }
  return { content, reasoning }
}

/** Non-streaming completion from the action model (with tools). */
async function callAction(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
  label: string
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const payload: Record<string, unknown> = { model, messages, tools, stream: false }
  if (modelSupportsTemperature(model)) payload.temperature = 0.2
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: apiHeaders(apiKey),
    body: JSON.stringify(payload)
  })
  await checkResponse(res, label)
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>
  }
  const msg = json.choices?.[0]?.message
  return {
    content: msg?.content ?? '',
    toolCalls: (msg?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? ''
    }))
  }
}

/**
 * Hybrid chat: the action model handles tool calls / mutations, then pure Q&A
 * is re-routed to the reasoning model for a deeper, streamed answer. Both
 * models come from the configured provider (DeepSeek, OpenAI, Claude or
 * Gemini, all through the OpenAI-compatible API).
 */
export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const cfg = aiConfig()
  if (!cfg.apiKey) {
    throw new Error(
      `No ${cfg.providerLabel} API key is configured. Add one in Settings → AI advisor.`
    )
  }
  if (!cfg.usable) {
    throw new Error(`The ${cfg.providerLabel} base URL or model is missing. Check Settings → AI advisor.`)
  }

  const baseUrl = cfg.baseUrl
  const actionModel = cfg.model
  const reasoningModel = cfg.reasoningModel || cfg.model
  const label = cfg.providerLabel
  const tools = toolDefinitions()

  const messages: Array<Record<string, unknown>> = opts.messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  let toolUsed = false
  let finalContent = ''

  for (let iter = 0; iter < 8; iter++) {
    const { content, toolCalls } = await callAction(baseUrl, cfg.apiKey, actionModel, messages, tools, label)
    if (toolCalls.length === 0) {
      finalContent = content
      break
    }

    toolUsed = true
    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments }
      }))
    })

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.arguments || '{}')
      } catch {
        args = {}
      }
      const result = await executeTool(tc.name, args)
      opts.onTool?.(tc.name, result.summary, result.actionId)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result.data) })
    }
  }

  if (toolUsed) {
    return { content: finalContent, reasoning: '' }
  }

  if (opts.noReasoningFallback) {
    return { content: finalContent, reasoning: '' }
  }

  // No tools were requested → route to the reasoning model for a deep answer.
  return streamReasoning(baseUrl, cfg.apiKey, reasoningModel, messages, opts, label)
}

/** Non-streaming convenience wrapper used for quick completions/tests. */
export async function chat(messages: ChatMessage[]): Promise<string> {
  const r = await streamChat({ messages, onToken: () => {} })
  return r.content
}

/** Fast, non-streaming completion using the action model directly (no tools,
 *  no reasoning fallback). Used for short summarisation / classification tasks. */
export { quickChat } from './llm'
