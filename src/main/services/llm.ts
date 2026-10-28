import { getSetting } from './settings'

export interface SimpleMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Fast, non-streaming completion using the action model directly (no tools, no
 * reasoning fallback). Used for short summarisation / classification tasks such
 * as email summaries and memory distillation.
 *
 * Kept in its own module (rather than in `deepseek.ts`) so that services which
 * the tool layer depends on can summarise without an import cycle through
 * `tools.ts`.
 */
export async function quickChat(messages: SimpleMessage[]): Promise<string> {
  const apiKey = getSetting('DEEPSEEK_API_KEY')
  if (!apiKey) return ''
  const baseUrl = (getSetting('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = getSetting('DEEPSEEK_MODEL') || 'deepseek-chat'

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: false, temperature: 0.2 })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`DeepSeek API error (${res.status}): ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return json.choices?.[0]?.message?.content ?? ''
  } catch (e) {
    console.error('quickChat failed:', e)
    return ''
  }
}
