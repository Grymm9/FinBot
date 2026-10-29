import { getDb } from '../db'
import { sendDiscordMessage } from './discord'
import { isAiConfigured } from './ai-config'
import { getSetting } from './settings'
import { todayLocalIso } from './dates'
import type { HealthStatus, ServiceHealth } from '@shared/types'

/**
 * Background service health.
 *
 * Every scheduler used to fail into `console.error`, which is invisible in a
 * packaged app: a revoked Akahu token or a rotated IMAP password silently
 * stopped the app working. Each scheduler now records success/failure here,
 * the Dashboard shows the state, and three consecutive failures trigger a
 * single Discord message (once per service per day).
 */

export const SERVICE_LABELS: Record<string, string> = {
  sync: 'Bank sync',
  alerts: 'Budget engine',
  email: 'Email scanning',
  discord: 'Discord',
  reminders: 'Reminders',
  memory: 'Memory',
  backup: 'Backups',
  update: 'App updates',
  deals: 'Deal checks'
}

export const TRACKED_SERVICES = Object.keys(SERVICE_LABELS)

export function recordOk(service: string): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO service_health (service, last_ok, last_error, last_error_at, consecutive_failures)
     VALUES (?, ?, NULL, NULL, 0)
     ON CONFLICT(service) DO UPDATE SET last_ok = excluded.last_ok, consecutive_failures = 0`
  ).run(service, Date.now())
}

export function recordFail(service: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const db = getDb()
  db.prepare(
    `INSERT INTO service_health (service, last_ok, last_error, last_error_at, consecutive_failures)
     VALUES (?, NULL, ?, ?, 1)
     ON CONFLICT(service) DO UPDATE SET
       last_error = excluded.last_error,
       last_error_at = excluded.last_error_at,
       consecutive_failures = consecutive_failures + 1`
  ).run(service, message.slice(0, 500), Date.now())

  const row = db
    .prepare('SELECT consecutive_failures AS f FROM service_health WHERE service = ?')
    .get(service) as { f: number } | undefined
  if (row && row.f >= 3) void alertFailure(service, row.f, message)
}

function statusFor(lastOk: number | null, failures: number): HealthStatus {
  if (failures >= 3) return 'fail'
  if (failures > 0) return 'warn'
  if (!lastOk) return 'unknown'
  return 'ok'
}

/**
 * Whether the service has everything it needs to run. Users can skip optional
 * integrations in setup, so "no credentials" must not look like a failure.
 */
export function isServiceConfigured(service: string): boolean {
  switch (service) {
    case 'sync':
      return !!getSetting('AKAHU_APP_TOKEN') && !!getSetting('AKAHU_USER_TOKEN')
    case 'email':
      return !!getSetting('EMAIL_ADDRESS') && !!getSetting('EMAIL_PASSWORD')
    case 'discord':
      return !!getSetting('DISCORD_BOT_TOKEN') && !!getSetting('DISCORD_CHANNEL_ID')
    case 'memory':
      return isAiConfigured()
    default:
      return true
  }
}

export function getHealth(): ServiceHealth[] {
  const rows = getDb()
    .prepare('SELECT service, last_ok, last_error, last_error_at, consecutive_failures FROM service_health')
    .all() as Array<{
    service: string
    last_ok: number | null
    last_error: string | null
    last_error_at: number | null
    consecutive_failures: number
  }>
  const byService = new Map(rows.map((r) => [r.service, r]))

  return TRACKED_SERVICES.map((service) => {
    const r = byService.get(service)
    const lastOk = r?.last_ok ?? null
    const failures = r?.consecutive_failures ?? 0
    return {
      service,
      label: SERVICE_LABELS[service] ?? service,
      status: statusFor(lastOk, failures),
      lastOk,
      lastError: r?.last_error ?? null,
      lastErrorAt: r?.last_error_at ?? null,
      failures,
      configured: isServiceConfigured(service)
    }
  })
}

export function healthTally(): { ok: number; degraded: number; failing: number } {
  const items = getHealth()
  return {
    ok: items.filter((i) => i.status === 'ok' || i.status === 'unknown').length,
    degraded: items.filter((i) => i.status === 'warn').length,
    failing: items.filter((i) => i.status === 'fail').length
  }
}

/** Run a scheduled task, recording success/failure. Never throws. */
export async function track<T>(service: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn()
    recordOk(service)
    return result
  } catch (e) {
    recordFail(service, e)
    return null
  }
}

/** Synchronous variant of `track` for in-process engine steps. */
export function trackSync<T>(service: string, fn: () => T): T | null {
  try {
    const result = fn()
    recordOk(service)
    return result
  } catch (e) {
    recordFail(service, e)
    return null
  }
}

/** Announce a service that has failed three times in a row (once per day). */
async function alertFailure(service: string, failures: number, message: string): Promise<void> {
  // Discord being down is the one failure we can't report over Discord.
  if (service === 'discord') return
  const key = `health:${service}:${todayLocalIso()}`
  const db = getDb()
  if (db.prepare('SELECT 1 AS x FROM notified_alerts WHERE alert_key = ?').get(key)) return

  const label = SERVICE_LABELS[service] ?? service
  try {
    const r = await sendDiscordMessage(
      `🛠️ **FinanceBot service failing**\n**${label}** has failed ${failures} times in a row.\n> ${message.slice(0, 200)}\n\nOpen Settings → Service health to investigate.`
    )
    if (r.ok) {
      db.prepare('INSERT OR IGNORE INTO notified_alerts (alert_key, sent_at) VALUES (?, ?)').run(key, Date.now())
    }
  } catch {
    // Best effort: the health table already records the failure.
  }
}
