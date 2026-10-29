import { app, dialog, shell, BrowserWindow } from 'electron'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import { closeDb, getDb } from '../db'
import { matchCategory } from './budget'
import { localIsoDate } from './dates'
import { recordFail, recordOk } from './health'
import { getSetting, setSetting } from './settings'
import type { BackupDirInfo, BackupImportResult, BackupInfo } from '@shared/types'

/**
 * Local data safety:
 *  - daily SQLite snapshots in a user-visible folder (7 kept, one per day)
 *  - import an existing snapshot, then restore it on demand
 *  - restore from a snapshot (relaunch required; current data is snapshotted first)
 *  - CSV export of the full transaction history
 *
 * The snapshot folder is chosen so it is easy to reach:
 *  - packaged: `<Documents>\FinanceBot Backups`
 *  - development: `<project>/Backup`
 *  - overridable with the `BACKUP_DIR` setting (Settings → Data & backups).
 */

const KEEP = 7
const SNAPSHOT_PATTERN = /^financebot-\d{4}-\d{2}-\d{2}\.sqlite3$/
const REQUIRED_TABLES = ['accounts', 'transactions', 'categories', 'settings']

const dbPath = (): string => join(app.getPath('userData'), 'financebot.sqlite3')

/** Resolved backup folder (custom setting, otherwise a sensible default). */
export function backupDir(): string {
  const custom = getSetting('BACKUP_DIR').trim()
  if (custom) return custom
  return app.isPackaged
    ? join(app.getPath('documents'), 'FinanceBot Backups')
    : join(app.getAppPath(), 'Backup')
}

export function backupDirInfo(): BackupDirInfo {
  return { dir: backupDir(), isCustom: !!getSetting('BACKUP_DIR').trim() }
}

function ensureDir(): string {
  const dir = backupDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function infoFor(dir: string, fileName: string): BackupInfo {
  const full = join(dir, fileName)
  const s = statSync(full)
  return { fileName, path: full, createdAt: s.mtimeMs, sizeBytes: s.size }
}

/**
 * Every SQLite file in the backup folder. Imported files appear here too, so
 * they can be restored from the same list.
 */
export function listBackups(): BackupInfo[] {
  const dir = backupDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sqlite3'))
    .map((f) => infoFor(dir, f))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Only our own dated snapshots are rotated; imported files are never deleted. */
function listSnapshots(): BackupInfo[] {
  return listBackups().filter((b) => SNAPSHOT_PATTERN.test(b.fileName))
}

function rotate(): void {
  for (const old of listSnapshots().slice(KEEP)) {
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
  const dir = ensureDir()
  const today = localIsoDate(new Date())
  const fileName = `financebot-${today}.sqlite3`
  const dest = join(dir, fileName)

  if (!force && existsSync(dest)) return infoFor(dir, fileName)

  // better-sqlite3's online backup is consistent even while the DB is open.
  await getDb().backup(dest)
  rotate()

  return infoFor(dir, fileName)
}

/**
 * Replace the live database with a snapshot and relaunch. A snapshot of the
 * current data is written first, so a mistaken restore is always recoverable.
 */
export async function restoreBackup(fileName: string): Promise<{ ok: boolean; error?: string }> {
  if (fileName !== basename(fileName)) return { ok: false, error: 'Invalid backup file name.' }
  const dir = backupDir()
  const source = join(dir, fileName)
  if (!existsSync(source)) return { ok: false, error: 'Backup file not found.' }

  try {
    // Safety net: keep what is live right now before overwriting it.
    await createBackup(true).catch(() => null)

    closeDb()
    for (const suffix of ['-wal', '-shm']) {
      const f = dbPath() + suffix
      if (existsSync(f)) rmSync(f, { force: true })
    }

    // Copy to a sibling temp file first, then swap atomically.
    const temp = `${dbPath()}.restore`
    copyFileSync(source, temp)
    renameSync(temp, dbPath())

    app.relaunch()
    app.exit(0)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Cheap structural check before copying a user-picked file into the folder. */
export function validateBackupFile(filePath: string): {
  ok: boolean
  error?: string
  transactions?: number
  accounts?: number
} {
  if (!existsSync(filePath)) return { ok: false, error: 'File not found.' }

  try {
    const fd = openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(16)
      readSync(fd, header, 0, 16, 0)
      if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
        return { ok: false, error: 'That file is not a SQLite database.' }
      }
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  let db: Database.Database | null = null
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true })
    const names = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (r) => r.name
      )
    )
    const missing = REQUIRED_TABLES.filter((t) => !names.has(t))
    if (missing.length > 0) {
      return { ok: false, error: `This file is missing FinanceBot data (${missing.join(', ')}).` }
    }
    const transactions = (db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n
    const accounts = (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
    return { ok: true, transactions, accounts }
  } catch (e) {
    return { ok: false, error: `Could not read that database: ${(e as Error).message}` }
  } finally {
    db?.close()
  }
}

/**
 * Pick a backup file, validate it, and copy it into the backup folder. The
 * user then presses Restore in the list (nothing is overwritten yet).
 */
export async function importBackupFile(parent?: BrowserWindow | null): Promise<BackupImportResult> {
  const options = {
    title: 'Import a FinanceBot backup',
    properties: ['openFile' as const],
    filters: [
      { name: 'FinanceBot backups', extensions: ['sqlite3', 'sqlite', 'db'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }

  const source = result.filePaths[0]
  const check = validateBackupFile(source)
  if (!check.ok) return { canceled: false, error: check.error ?? 'That file is not a valid backup.' }

  try {
    const dir = ensureDir()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const stem =
      basename(source)
        .replace(/\.(sqlite3|sqlite|db)$/i, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'backup'
    let fileName = `imported-${stamp}-${stem}.sqlite3`
    if (existsSync(join(dir, fileName))) fileName = `imported-${stamp}-${stem}-2.sqlite3`

    copyFileSync(source, join(dir, fileName))
    return {
      canceled: false,
      file: infoFor(dir, fileName),
      transactions: check.transactions,
      accounts: check.accounts
    }
  } catch (e) {
    return { canceled: false, error: (e as Error).message }
  }
}

/**
 * Point future snapshots at a new folder. Existing snapshots are copied across
 * (never moved or deleted) so the list is not empty after switching.
 */
export function setBackupDir(dir: string): { ok: boolean; dir: string; copied: number; error?: string } {
  const target = dir.trim()
  if (!target) return { ok: false, dir: backupDir(), copied: 0, error: 'Choose a folder first.' }

  try {
    if (!existsSync(target)) mkdirSync(target, { recursive: true })
  } catch (e) {
    return { ok: false, dir: backupDir(), copied: 0, error: (e as Error).message }
  }

  let copied = 0
  const previous = backupDir()
  if (previous !== target && existsSync(previous)) {
    for (const b of listBackups()) {
      const dest = join(target, b.fileName)
      if (existsSync(dest)) continue
      try {
        copyFileSync(b.path, dest)
        copied++
      } catch {
        // best effort — the new folder still works for future snapshots
      }
    }
  }

  setSetting('BACKUP_DIR', target)
  return { ok: true, dir: target, copied }
}

export async function chooseBackupDir(parent?: BrowserWindow | null): Promise<{
  canceled: boolean
  dir?: string
  copied?: number
  error?: string
}> {
  const options = {
    title: 'Choose a folder for FinanceBot backups',
    defaultPath: backupDir(),
    properties: ['openDirectory' as const, 'createDirectory' as const]
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }

  const res = setBackupDir(result.filePaths[0])
  if (!res.ok) return { canceled: false, error: res.error }
  return { canceled: false, dir: res.dir, copied: res.copied }
}

/** Open the backup folder in Explorer (creating it if needed). */
export async function openBackupDir(): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = ensureDir()
    const error = await shell.openPath(dir)
    return error ? { ok: false, error } : { ok: true }
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
        if (b) console.log(`Backup ready: ${b.path}`)
      })
      .catch((e) => recordFail('backup', e))
  }
  setTimeout(run, 90_000)
  return setInterval(run, 12 * 60 * 60 * 1000)
}
