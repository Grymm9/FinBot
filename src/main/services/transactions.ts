import { getDb } from '../db'
import { REAL_TX } from './filters'
import { matchCategory } from './budget'
import { round2 } from './reconcile-math'
import type { TransactionRow, TransactionSearchResult } from '@shared/types'

export interface TransactionFilter {
  query?: string
  /** Exact resolved category, or 'Uncategorised'. Empty = any. */
  category?: string
  accountId?: string
  from?: string
  to?: string
  limit?: number
}

/**
 * Browse/search real transactions with rule-resolved categories.
 *
 * Category is resolved in JS via `matchCategory` (rules, card mappings, Akahu
 * category fallbacks) because the stored `category` column is only the raw bank
 * value — so category filtering has to happen after resolution.
 */
export function searchTransactions(filter: TransactionFilter = {}): TransactionSearchResult {
  const db = getDb()
  const where: string[] = [REAL_TX]
  const params: Array<string | number> = []

  if (filter.from) {
    where.push('date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('date <= ?')
    params.push(filter.to)
  }
  if (filter.accountId) {
    where.push('account_id = ?')
    params.push(filter.accountId)
  }
  const q = (filter.query ?? '').trim()
  if (q) {
    where.push('(description LIKE ? OR COALESCE(merchant, \'\') LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }

  const fetchLimit = filter.category ? 5000 : Math.min(Math.max(filter.limit ?? 300, 1), 1000)

  const rows = db
    .prepare(
      `SELECT id, account_id, date, description, amount, type, category, merchant,
              (SELECT name FROM accounts WHERE accounts.id = transactions.account_id) AS account_name
       FROM transactions
       WHERE ${where.join(' AND ')}
       ORDER BY date DESC, id DESC
       LIMIT ?`
    )
    .all(...params, fetchLimit) as Array<{
    id: string
    account_id: string | null
    date: string
    description: string
    amount: number
    type: string | null
    category: string | null
    merchant: string | null
    account_name: string | null
  }>

  let mapped: TransactionRow[] = rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.date,
    description: r.description,
    amount: r.amount,
    type: r.type,
    category: r.category,
    merchant: r.merchant,
    accountName: r.account_name ?? '—',
    matchedCategory: matchCategory(r.description, r.merchant, r.category)
  }))

  if (filter.category) {
    mapped =
      filter.category === 'Uncategorised'
        ? mapped.filter((r) => !r.matchedCategory)
        : mapped.filter((r) => r.matchedCategory === filter.category)
  }

  const limit = Math.min(Math.max(filter.limit ?? 300, 1), 1000)
  mapped = mapped.slice(0, limit)

  let debit = 0
  let credit = 0
  for (const r of mapped) {
    if (r.amount < 0) debit += Math.abs(r.amount)
    else credit += r.amount
  }

  return {
    rows: mapped,
    count: mapped.length,
    totalDebit: round2(debit),
    totalCredit: round2(credit)
  }
}
