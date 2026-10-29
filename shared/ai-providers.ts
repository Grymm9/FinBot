/**
 * AI provider presets and resolution logic.
 *
 * FinanceBot talks to every provider through the OpenAI-compatible
 * `/chat/completions` API, so the only things that change per provider are the
 * base URL, the default model and the label shown in the UI.
 *
 * This module is deliberately free of Electron/database imports so it can be
 * unit-tested and imported by the renderer.
 */

export type AiProviderId = 'deepseek' | 'openai' | 'anthropic' | 'gemini' | 'custom'

export interface AiModelOption {
  id: string
  label: string
}

export interface AiProviderPreset {
  id: AiProviderId
  label: string
  /** OpenAI-compatible base URL (no trailing slash). Empty for `custom`. */
  baseUrl: string
  keyPlaceholder: string
  /** Where the user creates a key (shown as helper text). */
  keyHint: string
  models: AiModelOption[]
}

export const AI_PROVIDERS: AiProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    keyPlaceholder: 'sk-…',
    keyHint: 'platform.deepseek.com',
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat (fast)' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner (deep reasoning)' }
    ]
  },
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    baseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-…',
    keyHint: 'platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini (fast, cheap)' },
      { id: 'gpt-4o', label: 'gpt-4o' },
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      { id: 'gpt-4.1', label: 'gpt-4.1' },
      { id: 'o4-mini', label: 'o4-mini (reasoning)' }
    ]
  },
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    baseUrl: 'https://api.anthropic.com/v1',
    keyPlaceholder: 'sk-ant-…',
    keyHint: 'console.anthropic.com',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (fast)' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' }
    ]
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPlaceholder: 'AIza…',
    keyHint: 'aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (fast)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
    ]
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    baseUrl: '',
    keyPlaceholder: 'API key…',
    keyHint: 'your provider’s dashboard',
    models: []
  }
]

const BY_ID = new Map(AI_PROVIDERS.map((p) => [p.id, p]))

/** Empty or unknown provider ids fall back to DeepSeek / custom respectively. */
export function normalizeAiProvider(id: string | undefined | null): AiProviderId {
  const value = (id ?? '').trim().toLowerCase()
  if (!value) return 'deepseek'
  if (BY_ID.has(value as AiProviderId)) return value as AiProviderId
  return 'custom'
}

export function aiProviderPreset(id: string | undefined | null): AiProviderPreset {
  return BY_ID.get(normalizeAiProvider(id)) as AiProviderPreset
}

export interface AiConfigInput {
  provider?: string
  apiKey?: string
  model?: string
  baseUrl?: string
  reasoningModel?: string
  /** Pre-0.5 settings, still honoured so existing installs keep working. */
  legacy?: {
    apiKey?: string
    model?: string
    baseUrl?: string
    reasoningModel?: string
  }
}

export interface AiConfig {
  provider: AiProviderId
  providerLabel: string
  apiKey: string
  model: string
  baseUrl: string
  reasoningModel: string
  /** True when the selected provider has a base URL and model. */
  usable: boolean
}

const trimSlash = (url: string): string => url.trim().replace(/\/+$/, '')

/**
 * Resolve the effective AI configuration.
 *
 * The `AI_*` settings win. The old `DEEPSEEK_*` settings are only used as a
 * fallback while DeepSeek is the selected provider, so an existing user keeps
 * their key/model without migrating anything.
 */
export function resolveAiConfig(input: AiConfigInput): AiConfig {
  const provider = normalizeAiProvider(input.provider)
  const preset = aiProviderPreset(provider)
  const legacy = input.legacy ?? {}
  const legacyApplies = provider === 'deepseek'

  const apiKey = (input.apiKey ?? '').trim() || (legacyApplies ? (legacy.apiKey ?? '').trim() : '')
  const model =
    (input.model ?? '').trim() ||
    (legacyApplies ? (legacy.model ?? '').trim() : '') ||
    preset.models[0]?.id ||
    ''
  const baseUrl = trimSlash(
    (input.baseUrl ?? '').trim() || (legacyApplies ? (legacy.baseUrl ?? '').trim() : '') || preset.baseUrl
  )
  const reasoningModel =
    (input.reasoningModel ?? '').trim() ||
    (legacyApplies ? (legacy.reasoningModel ?? '').trim() : '') ||
    (provider === 'deepseek' ? 'deepseek-reasoner' : model)

  return {
    provider,
    providerLabel: preset.label,
    apiKey,
    model,
    baseUrl,
    reasoningModel,
    usable: !!baseUrl && !!model
  }
}

/**
 * Some OpenAI reasoning models reject an explicit temperature. Sending one to
 * them returns HTTP 400, so callers omit it for those model ids.
 */
export function modelSupportsTemperature(model: string): boolean {
  const m = model.trim().toLowerCase()
  if (!m) return true
  if (/^o[1-4](-|$)/.test(m)) return false
  if (/^gpt-5/.test(m)) return false
  return true
}
