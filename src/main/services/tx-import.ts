import { createHash } from 'node:crypto'
import { getDb } from '../db'
import { parseTransactionCsv } from './tx-csv'
import type { TransactionImportResult } from '@shared/types'

/**
 * Import a bank-statement CSV into the same tables Akahu fills, so budgets,
 * subscriptions, the forecast and alerts work without a bank connection.
 *
 * IDs are deterministic (hash of account + date + amount + description, with
 * an occurrence counter for genuine repeats), so importing the same statement
 * twice is a no-op instead of duplicating every row.
 */

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ')

function accountIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `csv:${slug || 'statement'}`
}

function ensureAccount(name: string): string {
  const db = getDb()
  const clean = normalizeName(name)
  const existing = db
    .prepare('SELECT id FROM accounts WHERE name = ? COLLATE NOCASE LIMIT 1')
    .get(clean) as { id: string } | undefined
  if (existing) return existing.id

  const id = accountIdFor(clean)
  db.prepare(
    `INSERT INTO accounts (id, name, type, connection_id, status, currency, raw, updated_at)
     VALUES (?, ?, 'statement', NULL, 'imported', 'NZD', ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(id, clean, JSON.stringify({ source: 'csv' }), Date.now())
  return id
}

export function importTransactionsCsv(
  text: string,
  options: { accountName?: string; fileName?: string } = {}
): TransactionImportResult {
  const parsed = parseTransactionCsv(text)
  const db = getDb()

  if (parsed.rows.length === 0) {
    return {
      imported: 0,
      skipped: parsed.skipped.length,
      dateFrom: null,
      dateTo: null,
      accountNames: [],
      skippedSample: parsed.skipped.slice(0, 5),
      columns: parsed.columns
    }
  }

  // One statement can contain several accounts. A caller-supplied name wins;
  // otherwise use the account column, then a generic fallback.
  const fallbackName = normalizeName(options.accountName || '') || 'Imported statement'
  const groups = new Map<string, typeof parsed.rows>()
  for (const row of parsed.rows) {
    const name = normalizeName(row.account || '') || fallbackName
    const list = groups.get(name) ?? []
    list.push(row)
    groups.set(name, list)
  }

  const insert = db.prepare(
    `INSERT INTO transactions (id, account_id, date, description, amount, type, category, merchant, raw)
     VALUES (@id, @account_id, @date, @description, @amount, @type, NULL, NULL, @raw)
     ON CONFLICT(id) DO NOTHING`
  )

  let imported = 0
  let duplicates = 0
  const seen = new Map<string, number>()
  const accountNames: string[] = []
  let dateFrom: string | null = null
  let dateTo: string | null = null

  const run = db.transaction(() => {
    for (const [name, rows] of groups) {
      const accountId = ensureAccount(name)
      accountNames.push(name)
      for (const row of rows) {
        const base = `${accountId}|${row.date}|${row.amount.toFixed(2)}|${row.description}`
        const occurrence = (seen.get(base) ?? 0) + 1
        seen.set(base, occurrence)
        const id = `csv:${createHash('sha1').update(`${base}|${occurrence}`).digest('hex').slice(0, 24)}`

        const result = insert.run({
          id,
          account_id: accountId,
          date: row.date,
          description: row.description,
          amount: row.amount,
          type: row.type,
          raw: JSON.stringify({ ...row, source: 'csv', file: options.fileName ?? null })
        })
        if (result.changes > 0) imported++
        else duplicates++

        if (!dateFrom || row.date < dateFrom) dateFrom = row.date
        if (!dateTo || row.date > dateTo) dateTo = row.date
      }
    }
  })
  run()

  // Balances aren't in a statement export, so the imported account is excluded
  // from the net-worth figure until the user adds a balance in Accounts.
  return {
    imported,
    skipped: parsed.skipped.length + duplicates,
    dateFrom,
    dateTo,
    accountNames,
    skippedSample: parsed.skipped.slice(0, 5),
    columns: parsed.columns
  }
}
