import { syncAll } from './akahu'
import { getSetting, getSettingNumber } from './settings'
import { recordFail, recordOk } from './health'
import type { SyncResult } from '@shared/types'

/**
 * Background bank sync.
 *
 * Akahu data used to refresh only when the user pressed "Sync bank", while the
 * alert scheduler evaluated budget pace every 6 hours — so alerts could be
 * based on days-old data. This scheduler syncs on launch and every
 * `AUTO_SYNC_HOURS` (0 disables the periodic sync).
 */

let running = false

export function lastSyncAt(): number {
  const raw = getSetting('last_sync')
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

/** Sync now. Returns null when Akahu is not configured or the sync fails. */
export async function runBankSync(reason: string): Promise<SyncResult | null> {
  if (!getSetting('AKAHU_APP_TOKEN') || !getSetting('AKAHU_USER_TOKEN')) return null
  if (running) return null
  running = true
  try {
    const result = await syncAll(365)
    recordOk('sync')
    console.log(`Bank sync (${reason}): ${result.transactions} tx, ${result.accounts} accounts`)
    return result
  } catch (e) {
    recordFail('sync', e)
    console.error(`Bank sync (${reason}) failed:`, (e as Error).message)
    return null
  } finally {
    running = false
  }
}

/** Sync only if the last successful sync is older than `minutes`. */
export async function syncIfStale(minutes: number): Promise<boolean> {
  const last = lastSyncAt()
  if (last && Date.now() - last < minutes * 60_000) return false
  const result = await runBankSync('stale')
  return result !== null
}

export function startSyncScheduler(): NodeJS.Timeout | null {
  const hours = getSettingNumber('AUTO_SYNC_HOURS', 4)
  setTimeout(() => void runBankSync('launch'), 20_000)
  if (hours <= 0) return null
  return setInterval(() => void runBankSync('scheduled'), hours * 60 * 60 * 1000)
}
