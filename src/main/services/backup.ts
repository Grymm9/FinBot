import { app, dialog, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeDb, getDb } from '../db'
import { matchCategory } from './budget'
import { localIsoDate } from './dates'
import { recordFail, recordOk } from './health'
import type { BackupInfo } from '@shared/types'

/**
 * Local data safety:
 *  - daily SQLite snapshots in `<userData>/backups` (7 kept, one per day)
 *  - restore from a snapshot (relaunch required)
 *  - CSV export of the full transaction history
 */

const KEEP = 7

const backupDir = (): string => join(app.getPath('userData'), 'backups')
const dbPath = (): string => join(app.getPath('userData'), 'financebot.sqlite3')

function ensureDir(): void {
  const dir = backupDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function listBackups(): BackupInfo[] {
  const dir = backupDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite3'))
    .map((f) => {
      const full = join(dir, f)
      const s = statSync(full)
      return { fileName: f, path: full, createdAt: s.mtimeMs, sizeBytes: s.size }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

function rotate(): void {
  const all = listBackups()
  for (const old of all.slice(KEEP)) {
    try {
      rmSync(old.path, { force: true })
    } catch {
      // best effort
    }
  }
}

/**
 * Snapshot the database. By default only one backup per calendar day is kept
 * (re-running on the same day is a no-op unless `force` is set).
 */
export async function createBackup(force = false): Promise<BackupInfo | null> {
  ensureDir()
  const today = localIsoDate(new Date())
  const fileName = `financebot-${today}.sqlite3`
  const dest = join(backupDir(), fileName)

  if (!force && existsSync(dest)) {
    const s = statSync(dest)
    return { fileName, path: dest, createdAt: s.mtimeMs, sizeBytes: s.size }
  }

  // better-sqlite3's online backup is consistent even while the DB is open.
  await getDb().backup(dest)
  rotate()

  const s = statSync(dest)
  return { fileName, path: dest, createdAt: s.mtimeMs, sizeBytes: s.size }
}

/**
 * Replace the live database with a snapshot and relaunch. The app must not
 * keep using the old connection, so we close it and restart the process.
 */
export function restoreBackup(fileName: string): { ok: boolean; error?: string } {
  const source = join(backupDir(), fileName)
  if (!existsSync(source)) return { ok: false, error: 'Backup file not found.' }

  try {
    closeDb()
    copyFileSync(source, dbPath())
    for (const suffix of ['-wal', '-shm']) {
      const f = dbPath() + suffix
      if (existsSync(f)) rmSync(f, { force: true })
    }
    app.relaunch()
    app.exit(0)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Export every transaction (with resolved category) to a CSV the user chooses. */
export async function exportTransactionsCsv(parent?: BrowserWindow | null): Promise<{
  canceled: boolean
  path?: string
  rows?: number
  error?: string
}> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT t.date, a.name AS account, t.description, t.amount, t.type, t.category, t.merchant, t.account_id
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
       ORDER BY t.date DESC, t.id`
    )
    .all() as Array<{
    date: string
    account: string | null
    description: string
    amount: number
    type: string | null
    category: string | null
    merchant: string | null
    account_id: string | null
  }>

  const header = ['date', 'account', 'description', 'amount', 'type', 'bank_category', 'matched_category', 'merchant']
  const escape = (v: string | number | null): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.account,
        r.description,
        r.amount,
        r.type,
        r.category,
        matchCategory(r.description, r.merchant, r.category),
        r.merchant
      ]
        .map(escape)
        .join(',')
    )
  }

  const options = {
    title: 'Export transactions',
    defaultPath: join(app.getPath('documents'), `financebot-transactions-${localIsoDate(new Date())}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true }

  try {
    writeFileSync(result.filePath, lines.join('\n'), 'utf8')
    return { canceled: false, path: result.filePath, rows: rows.length }
  } catch (e) {
    return { canceled: false, error: (e as Error).message }
  }
}

/** Daily snapshot on launch, then every 12 hours (rotation handles dedupe). */
export function startBackupScheduler(): NodeJS.Timeout {
  const run = (): void => {
    createBackup()
      .then((b) => {
        recordOk('backup')
        if (b) console.log(`Backup ready: ${b.fileName}`)
      })
      .catch((e) => recordFail('backup', e))
  }
  setTimeout(run, 90_000)
  return setInterval(run, 12 * 60 * 60 * 1000)
}
