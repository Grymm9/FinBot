import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_PROVIDERS,
  aiProviderPreset,
  modelSupportsTemperature,
  normalizeAiProvider,
  resolveAiConfig
} from '../shared/ai-providers.ts'

test('known provider ids resolve, unknown ids fall back to custom', () => {
  assert.equal(normalizeAiProvider(''), 'deepseek')
  assert.equal(normalizeAiProvider('OpenAI'), 'openai')
  assert.equal(normalizeAiProvider('anthropic'), 'anthropic')
  assert.equal(normalizeAiProvider('gemini'), 'gemini')
  assert.equal(normalizeAiProvider('some-local-server'), 'custom')
})

test('presets expose OpenAI-compatible base URLs and starting models', () => {
  for (const id of ['deepseek', 'openai', 'anthropic', 'gemini'] as const) {
    const preset = aiProviderPreset(id)
    assert.ok(preset.baseUrl.startsWith('https://'), `${id} needs a base URL`)
    assert.ok(preset.models.length > 0, `${id} needs at least one model`)
  }
  assert.ok(AI_PROVIDERS.some((p) => p.id === 'custom'))
})

test('an existing DeepSeek install keeps working without migration', () => {
  const cfg = resolveAiConfig({
    legacy: {
      apiKey: 'sk-deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/',
      reasoningModel: 'deepseek-reasoner'
    }
  })
  assert.equal(cfg.provider, 'deepseek')
  assert.equal(cfg.apiKey, 'sk-deepseek')
  assert.equal(cfg.model, 'deepseek-chat')
  assert.equal(cfg.baseUrl, 'https://api.deepseek.com')
  assert.equal(cfg.reasoningModel, 'deepseek-reasoner')
  assert.equal(cfg.usable, true)
})

test('AI_* settings take precedence over the legacy DeepSeek keys', () => {
  const cfg = resolveAiConfig({
    provider: 'gemini',
    apiKey: 'AIza-new',
    model: 'gemini-2.5-flash',
    legacy: { apiKey: 'sk-old', model: 'deepseek-chat' }
  })
  assert.equal(cfg.provider, 'gemini')
  assert.equal(cfg.providerLabel, 'Gemini (Google)')
  assert.equal(cfg.apiKey, 'AIza-new')
  assert.equal(cfg.model, 'gemini-2.5-flash')
  assert.equal(cfg.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai')
  // Non-DeepSeek providers reuse the chosen model for the second pass.
  assert.equal(cfg.reasoningModel, 'gemini-2.5-flash')
})

test('switching provider never reuses the DeepSeek key', () => {
  const cfg = resolveAiConfig({
    provider: 'openai',
    legacy: { apiKey: 'sk-deepseek', model: 'deepseek-chat' }
  })
  assert.equal(cfg.apiKey, '')
  assert.equal(cfg.model, 'gpt-4o-mini')
  assert.equal(cfg.baseUrl, 'https://api.openai.com/v1')
  assert.equal(cfg.usable, true, 'base/model are still usable; only the key is missing')
})

test('custom provider needs an explicit base URL and model', () => {
  assert.equal(resolveAiConfig({ provider: 'custom' }).usable, false)
  const cfg = resolveAiConfig({
    provider: 'custom',
    apiKey: 'secret',
    baseUrl: 'http://localhost:1234/v1/',
    model: 'local-model'
  })
  assert.equal(cfg.baseUrl, 'http://localhost:1234/v1')
  assert.equal(cfg.model, 'local-model')
  assert.equal(cfg.usable, true)
})

test('explicit reasoning model overrides the provider default', () => {
  const cfg = resolveAiConfig({ provider: 'deepseek', reasoningModel: 'deepseek-reasoner' })
  assert.equal(cfg.reasoningModel, 'deepseek-reasoner')
})

test('OpenAI reasoning models omit temperature', () => {
  assert.equal(modelSupportsTemperature('o4-mini'), false)
  assert.equal(modelSupportsTemperature('o3'), false)
  assert.equal(modelSupportsTemperature('gpt-5-mini'), false)
  assert.equal(modelSupportsTemperature('gpt-4o-mini'), true)
  assert.equal(modelSupportsTemperature('claude-sonnet-4-20250514'), true)
  assert.equal(modelSupportsTemperature('gemini-2.5-flash'), true)
  assert.equal(modelSupportsTemperature('deepseek-chat'), true)
})
