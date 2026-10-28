import { getDb } from '../db'
import { sendDiscordMessage } from './discord'
import { track } from './health'
import { localIsoDate, parseLocalDate, todayLocalIso } from './dates'
import type { Reminder } from '@shared/types'

export function scheduleReminder(message: string, at: Date): void {
  getDb()
    .prepare('INSERT INTO reminders (message, scheduled_at, sent, created_at) VALUES (?, ?, 0, ?)')
    .run(message, at.getTime(), Date.now())
}

/** Send any reminders that are due. Returns how many were attempted. */
export async function checkDueReminders(): Promise<number> {
  const db = getDb()
  const due = db
    .prepare('SELECT id, message, scheduled_at FROM reminders WHERE sent = 0 AND scheduled_at <= ? ORDER BY scheduled_at')
    .all(Date.now()) as Array<{ id: number; message: string; scheduled_at: number }>

  let attempted = 0
  for (const r of due) {
    attempted++
    try {
      const res = await sendDiscordMessage(`⏰ **Reminder**: ${r.message}`)
      if (res.ok) {
        db.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').run(r.id)
      }
    } catch (e) {
      console.error('Reminder send failed:', e)
    }
  }
  return attempted
}

/** Poll every minute for due reminders. */
export function startReminderScheduler(): NodeJS.Timeout {
  const run = (): void => {
    const task = async (): Promise<void> => {
      await checkDueReminders()
      checkUserReminders()
    }
    void track('reminders', task)
  }
  setTimeout(run, 5_000)
  return setInterval(run, 60_000)
}

// ---------------------------------------------------------------------------
// User reminders (date-based, repeatable, notified at T-5 / T-2 / T-0)
// ---------------------------------------------------------------------------

export function listUserReminders(): Reminder[] {
  const rows = getDb()
    .prepare('SELECT id, message, target_date, repeat FROM user_reminders ORDER BY target_date, id')
    .all() as Array<{ id: number; message: string; target_date: string; repeat: string }>
  return rows.map((r) => ({ id: r.id, message: r.message, targetDate: r.target_date, repeat: r.repeat }))
}

export function createUserReminder(message: string, targetDate: string, repeat: string): Reminder[] {
  const db = getDb()
  const r = repeat === 'weekly' || repeat === 'fortnightly' || repeat === 'monthly' ? repeat : 'none'
  db.prepare('INSERT INTO user_reminders (message, target_date, repeat, created_at) VALUES (?, ?, ?, ?)').run(
    message.trim(),
    targetDate,
    r,
    Date.now()
  )
  return listUserReminders()
}

export function deleteUserReminder(id: number): Reminder[] {
  const db = getDb()
  db.prepare('DELETE FROM reminder_events WHERE reminder_id = ?').run(id)
  db.prepare('DELETE FROM user_reminders WHERE id = ?').run(id)
  return listUserReminders()
}

/** Advance a target date by the repeat interval (monthly uses calendar months). */
function advanceRepeat(date: Date, repeat: string): Date {
  if (repeat === 'weekly') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7)
  if (repeat === 'fortnightly') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 14)
  if (repeat === 'monthly') return new Date(date.getFullYear(), date.getMonth() + 1, date.getDate())
  return date
}

/**
 * Fire Discord notifications for any user reminder that is due at T-5, T-2 or
 * T-0 days. Returns the number of notifications sent.
 */
export function checkUserReminders(): number {
  const db = getDb()
  const today = parseLocalDate(todayLocalIso())
  const todayIso = localIsoDate(today)
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5)

  const reminders = db
    .prepare('SELECT id, message, target_date, repeat FROM user_reminders')
    .all() as Array<{ id: number; message: string; target_date: string; repeat: string }>

  const eventExists = db.prepare(
    'SELECT 1 FROM reminder_events WHERE reminder_id = ? AND target_date = ? AND offset_days = ?'
  )
  const recordEvent = db.prepare(
    'INSERT OR IGNORE INTO reminder_events (reminder_id, target_date, offset_days, sent_at) VALUES (?, ?, ?, ?)'
  )

  const OFFSETS = [5, 2, 0]
  let sent = 0

  for (const r of reminders) {
    const base = parseLocalDate(r.target_date)
    const targets: Date[] = []
    let t = base
    while (t.getTime() <= horizon.getTime()) {
      targets.push(t)
      if (r.repeat === 'none') break
      const next = advanceRepeat(t, r.repeat)
      if (next.getTime() === t.getTime()) break // safety against no-op
      t = next
    }

    for (const target of targets) {
      const targetIso = localIsoDate(target)
      for (const offset of OFFSETS) {
        const notifyDate = new Date(target.getFullYear(), target.getMonth(), target.getDate() - offset)
        if (localIsoDate(notifyDate) !== todayIso) continue
        if (eventExists.get(r.id, targetIso, offset)) continue

        const label = offset === 0 ? 'is due today' : `is due in ${offset} day${offset > 1 ? 's' : ''}`
        const when = offset === 0 ? 'today' : targetIso
        void sendDiscordMessage(`⏰ **Reminder**: ${r.message} — ${label} (${when})`).catch(() => {})
        recordEvent.run(r.id, targetIso, offset, Date.now())
        sent++
      }
    }
  }
  return sent
}
