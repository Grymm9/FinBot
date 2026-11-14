import { getDb } from '../db'
import { REAL_TX } from './filters'
import { isAssetAccountType, normaliseSplits } from './split-math'
import type { SplitTransactionResult, TransactionSplit } from '@shared/types'

/**
 * Split one bank transaction across several budget categories.
 *
 * The parent transaction keeps its original amount and sign; the split rows
 * hold positive absolute portions. Budget calculations use the split rows
 * instead of the single resolved category, so the transaction's effect moves
 * out of whichever category it previously matched.
 */

export interface SplitRequest {
  transactionId?: unknown
  date?: unknown
  description?: unknown
  amount?: unknown
  splits?: unknown
  replace?: unknown
}

export interface SplitServiceResult extends SplitTransactionResult {
  /** Existing split before the change, for the AI undo trail. */
  previousSplits?: TransactionSplit[]
}

interface TxRow {
  id: string
  account_id: string | null
  date: string
  description: string
  amount: number
}

export function listSplits(transactionId: string): TransactionSplit[] {
  return getDb()
    .prepare('SELECT category, amount FROM transaction_splits WHERE transaction_id = ? ORDER BY id')
    .all(transactionId) as TransactionSplit[]
}

/** Bulk lookup used by search results and the financial context. */
export function splitsByTransaction(ids: string[]): Map<string, TransactionSplit[]> {
  const out = new Map<string, TransactionSplit[]>()
  if (ids.length === 0) return out

  const db = getDb()
  // Stay under SQLite's bound-parameter limit on large result pages.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT transaction_id, category, amount FROM transaction_splits
         WHERE transaction_id IN (${placeholders}) ORDER BY id`
      )
      .all(...chunk) as Array<{ transaction_id: string; category: string; amount: number }>
    for (const r of rows) {
      const list = out.get(r.transaction_id) ?? []
      list.push({ category: r.category, amount: r.amount })
      out.set(r.transaction_id, list)
    }
  }
  return out
}

function resolveTransaction(req: SplitRequest): { tx?: TxRow; error?: string } {
  const db = getDb()
  const id = req.transactionId !== undefined && req.transactionId !== null ? String(req.transactionId).trim() : ''
  if (id) {
    const tx = db
      .prepare('SELECT id, account_id, date, description, amount FROM transactions WHERE id = ?')
      .get(id) as TxRow | undefined
    return tx ? { tx } : { error: `No transaction found with id "${id}".` }
  }

  const date = String(req.date ?? '').trim()
  const description = String(req.description ?? '').trim()
  const amount = Number(req.amount)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || !Number.isFinite(amount)) {
    return { error: 'Provide transaction_id, or date + description + amount to identify the transaction.' }
  }

  const rows = db
    .prepare(
      `SELECT id, account_id, date, description, amount FROM transactions
       WHERE date = ? AND amount < 0 AND ABS(ABS(amount) - ?) < 0.01 AND lower(description) LIKE ?
       ORDER BY length(description) ASC, id DESC LIMIT 5`
    )
    .all(date, Math.abs(amount), `%${description.toLowerCase()}%`) as TxRow[]

  if (rows.length === 0) {
    return {
      error: `No debit transaction found on ${date} matching "${description}" for $${Math.abs(amount).toFixed(2)}.`
    }
  }
  if (rows.length > 1) {
    const candidates = rows
      .slice(0, 3)
      .map((t) => `${t.id} (${t.date} ${t.description} $${t.amount.toFixed(2)})`)
      .join('; ')
    return { error: `Multiple transactions match. Use transaction_id: ${candidates}.` }
  }
  return { tx: rows[0] }
}

/**
 * Why a transaction cannot be split: credits, disabled accounts,
 * loan/asset accounts and internal money movement are all rejected.
 */
export function splitProblem(tx: TxRow): string | null {
  if (tx.amount >= 0) return 'Only debit (money-out) transactions can be split across categories.'

  const account = getDb()
    .prepare('SELECT name, type, enabled FROM accounts WHERE id = ?')
    .get(tx.account_id) as { name: string; type: string | null; enabled: number } | undefined
  if (!account) return 'This transaction is not linked to a known account.'
  if (account.enabled !== 1) {
    return `Splits are not available for the "${account.name}" account because it is excluded from budgeting.`
  }
  if (isAssetAccountType(account.type)) {
    return `Splits are not available for loan or asset accounts ("${account.name}").`
  }

  const real = getDb().prepare(`SELECT 1 AS ok FROM transactions WHERE id = ? AND ${REAL_TX}`).get(tx.id)
  if (!real) {
    return 'This transaction is excluded from budgeting (internal transfer, ATM withdrawal or envelope funding).'
  }
  return null
}

const describeSplits = (splits: TransactionSplit[]): string =>
  splits.map((s) => `${s.category} $${s.amount.toFixed(2)}`).join(', ')

/**
 * Apply a split, replace one, or clear it.
 *
 * Existing splits are protected unless `replace` is true. Passing an empty
 * splits array with `replace: true` clears the split.
 */
export function splitTransaction(req: SplitRequest): SplitServiceResult {
  const resolved = resolveTransaction(req)
  if (!resolved.tx) return { ok: false, error: resolved.error }
  const tx = resolved.tx
  const transaction = { id: tx.id, date: tx.date, description: tx.description, amount: tx.amount }

  const before = listSplits(tx.id)
  const replace = req.replace === true
  if (before.length > 0 && !replace) {
    return {
      ok: false,
      error: `This transaction is already split (${describeSplits(before)}). Pass replace: true to replace it, or clear the split first.`,
      transaction,
      splits: before
    }
  }

  if (!Array.isArray(req.splits)) {
    return { ok: false, error: 'splits must be an array of { category, amount } objects.', transaction, splits: before }
  }

  const db = getDb()

  // Empty array + replace clears the split.
  if (req.splits.length === 0) {
    if (!replace) {
      return {
        ok: false,
        error: 'splits is empty. Pass replace: true to clear the existing split.',
        transaction,
        splits: before
      }
    }
    if (before.length === 0) {
      return {
        ok: true,
        changed: false,
        summary: `"${tx.description}" is not split; nothing to clear.`,
        transaction,
        splits: [],
        previousSplits: []
      }
    }
    db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(tx.id)
    return {
      ok: true,
      changed: true,
      summary: `Cleared the split on "${tx.description}" (${tx.date}). It is a single transaction again.`,
      transaction,
      splits: [],
      previousSplits: before
    }
  }

  const problem = splitProblem(tx)
  if (problem) return { ok: false, error: problem, transaction, splits: before }

  const categoryNames = (
    db.prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE').all() as Array<{ name: string }>
  ).map((r) => r.name)

  const normalised = normaliseSplits(req.splits, categoryNames, tx.amount)
  if (!normalised.ok) {
    return { ok: false, error: normalised.error, transaction, splits: before }
  }

  const now = Date.now()
  const insert = db.prepare(
    'INSERT INTO transaction_splits (transaction_id, category, amount, created_at) VALUES (?, ?, ?, ?)'
  )
  const apply = db.transaction(() => {
    db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(tx.id)
    for (const line of normalised.splits) insert.run(tx.id, line.category, line.amount, now)
  })
  apply()

  // Read back so the confirmation reports exactly what persisted.
  const after = listSplits(tx.id)
  const summary = `Split $${Math.abs(tx.amount).toFixed(2)} transaction "${tx.description}" (${tx.date}): ${describeSplits(after)}.`

  return {
    ok: true,
    changed: true,
    summary,
    transaction,
    splits: after,
    previousSplits: before
  }
}
