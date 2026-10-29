import { aiConfig } from './ai-config'
import { modelSupportsTemperature } from '@shared/ai-providers'

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
 * `tools.ts`. Works with any configured OpenAI-compatible provider.
 */
export async function quickChat(messages: SimpleMessage[]): Promise<string> {
  const cfg = aiConfig()
  if (!cfg.apiKey || !cfg.usable) return ''

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: false
  }
  if (modelSupportsTemperature(cfg.model)) payload.temperature = 0.2

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${cfg.providerLabel} API error (${res.status}): ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return json.choices?.[0]?.message?.content ?? ''
  } catch (e) {
    console.error('quickChat failed:', e)
    return ''
  }
}
