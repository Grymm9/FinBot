import { getDb } from '../db'
import { currentCycleRange } from './cycle'

/** Dismiss a notification (missed payment or duplicate charge) for this cycle. */
export function dismissAlert(key: string): void {
  const cycle = currentCycleRange()
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO dismissed_alerts (alert_key, cycle_start, created_at) VALUES (?, ?, ?)'
    )
    .run(key, cycle.start, Date.now())
}

/** The set of dismissed alert keys for the current cycle. */
export function dismissedKeys(): Set<string> {
  const cycle = currentCycleRange()
  const rows = getDb()
    .prepare('SELECT alert_key FROM dismissed_alerts WHERE cycle_start = ?')
    .all(cycle.start) as Array<{ alert_key: string }>
  return new Set(rows.map((r) => r.alert_key))
}
