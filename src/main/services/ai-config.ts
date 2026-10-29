import { getSetting } from './settings'
import { resolveAiConfig, type AiConfig } from '@shared/ai-providers'

/**
 * Read the effective AI configuration from settings.
 *
 * New installs use `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL`.
 * Existing DeepSeek installs keep working through the legacy `DEEPSEEK_*`
 * fallback in `resolveAiConfig` — nothing needs to be migrated or re-entered.
 */
export function aiConfig(): AiConfig {
  return resolveAiConfig({
    provider: getSetting('AI_PROVIDER'),
    apiKey: getSetting('AI_API_KEY'),
    model: getSetting('AI_MODEL'),
    baseUrl: getSetting('AI_BASE_URL'),
    reasoningModel: getSetting('AI_REASONING_MODEL'),
    legacy: {
      apiKey: getSetting('DEEPSEEK_API_KEY'),
      model: getSetting('DEEPSEEK_MODEL'),
      baseUrl: getSetting('DEEPSEEK_BASE_URL'),
      reasoningModel: getSetting('DEEPSEEK_REASONING_MODEL')
    }
  })
}

/** True when an API key is saved (or provided via `.env`). */
export function isAiConfigured(): boolean {
  return !!aiConfig().apiKey
}
