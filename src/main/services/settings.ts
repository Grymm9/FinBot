import { getDb } from '../db'
import { decryptValue, encryptValue, isEncrypted, isSecretKey } from './secrets'

const DEFAULTS: Record<string, string> = {
  INCOME_CYCLE_DAY: '15',
  INCOME_CYCLE_FREQUENCY: 'monthly',
  INCOME_CYCLE_WEEKEND: 'previous',
  BUDGET_CHECK_DAY: '15',
  BUDGET_ACTIVE_FROM: '',
  ALERT_SPEND_RATIO: '0.8',
  EMAIL_LABEL: 'Important Finances',
  AUTO_SYNC_HOURS: '4',
  LOW_BALANCE_BUFFER: '50',
  LARGE_TX_MIN: '300',
  LARGE_TX_DAYS: '3',
  DISCORD_USE_THREADS: '1'
}

/**
 * Read a setting. Resolution order: database value -> environment
 * variable -> built-in default.
 *
 * Secret values are decrypted transparently, so callers (Akahu, DeepSeek,
 * Discord, IMAP) never need to know about encryption.
 */
export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (row && row.value !== '') {
    return isSecretKey(key) ? decryptValue(row.value) : row.value
  }
  if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key] as string
  return DEFAULTS[key] ?? fallback
}

export function getSettingNumber(key: string, fallback = 0): number {
  const raw = getSetting(key)
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function setSetting(key: string, value: string): void {
  const stored = isSecretKey(key) ? encryptValue(value) : value
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, stored)
}

/** All settings with secrets decrypted (used by the UI and read-back tools). */
export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = isSecretKey(r.key) ? decryptValue(r.value) : r.value
  return out
}

/**
 * One-time upgrade: encrypt any secret that was written before at-rest
 * encryption existed. Idempotent, and safe to call on every launch.
 */
export function migrateSecrets(): number {
  const db = getDb()
  const rows = db
    .prepare('SELECT key, value FROM settings')
    .all() as Array<{ key: string; value: string }>
  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?')

  let changed = 0
  for (const r of rows) {
    if (!isSecretKey(r.key) || !r.value || isEncrypted(r.value)) continue
    const enc = encryptValue(r.value)
    if (enc !== r.value) {
      update.run(enc, r.key)
      changed++
    }
  }
  return changed
}
