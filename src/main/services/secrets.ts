import { safeStorage } from 'electron'

/**
 * At-rest encryption for secrets stored in the settings table.
 *
 * Values encrypted with Electron's `safeStorage` (Windows DPAPI) are prefixed
 * with `enc:v1:` and base64-encoded. Anything without the prefix is treated as
 * legacy plaintext and is transparently re-encrypted on the next write.
 *
 * If the OS keystore is unavailable (e.g. a headless test run) we fall back to
 * storing plaintext rather than breaking the app.
 */

const PREFIX = 'enc:v1:'

/** Setting keys whose values must never be stored in plaintext. */
export const SECRET_KEYS = new Set([
  'AKAHU_APP_TOKEN',
  'AKAHU_USER_TOKEN',
  'DEEPSEEK_API_KEY',
  'AI_API_KEY',
  'DISCORD_BOT_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'EMAIL_PASSWORD'
])

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key)
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

/** Encrypt a secret for storage. No-op when already encrypted or unavailable. */
export function encryptValue(value: string): string {
  if (!value || isEncrypted(value)) return value
  try {
    if (!safeStorage.isEncryptionAvailable()) return value
    return PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value
  }
}

export function decryptValue(value: string): string {
  if (!isEncrypted(value)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'))
  } catch {
    // A keystore change (new Windows profile) makes old values undecryptable.
    return ''
  }
}
