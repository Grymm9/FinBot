/**
 * Pure validation for transaction splits.
 *
 * Split amounts are stored as positive absolute values; the parent transaction
 * carries the sign (all splits are debits). Money is compared in cents so
 * floating-point noise never rejects an exact split.
 */

export interface SplitLine {
  category: string
  amount: number
}

export interface NormalisedSplits {
  ok: boolean
  error?: string
  splits: SplitLine[]
  /** Cents, after merging duplicate categories. */
  totalCents: number
  transactionCents: number
}

/**
 * Loan and asset accounts are not spending accounts, so their transactions
 * cannot be split across budget categories.
 */
export function isAssetAccountType(type: string | null | undefined): boolean {
  const t = (type ?? '').toUpperCase()
  return /LOAN|SAVINGS|INVEST|KIWISAVER|ASSET|TERM.?_?DEPOSIT/.test(t)
}

const cents = (n: number): number => Math.round(n * 100)

/**
 * Validate raw split input against the budget category list and the parent
 * transaction amount (signed; its absolute value is used).
 *
 * Unknown categories, non-positive amounts and totals that do not match are
 * rejected with a clear message. Duplicate categories are merged.
 */
export function normaliseSplits(
  raw: unknown,
  categoryNames: string[],
  transactionAmount: number
): NormalisedSplits {
  const transactionCents = cents(Math.abs(transactionAmount))
  const transactionTotal = (transactionCents / 100).toFixed(2)

  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      error: 'Provide at least one split line, or pass an empty list with replace: true to clear an existing split.',
      splits: [],
      totalCents: 0,
      transactionCents
    }
  }

  if (categoryNames.length === 0) {
    return {
      ok: false,
      error: 'There are no budget categories yet. Create a category before splitting a transaction.',
      splits: [],
      totalCents: 0,
      transactionCents
    }
  }

  // Case-insensitive canonical lookup, e.g. "groceries" -> "Groceries".
  const byLower = new Map<string, string>()
  for (const name of categoryNames) byLower.set(name.toLowerCase(), name)

  const merged = new Map<string, SplitLine>()
  for (const item of raw) {
    const line = (item ?? {}) as { category?: unknown; amount?: unknown }
    const requested = String(line.category ?? '').trim()
    const canonical = requested ? byLower.get(requested.toLowerCase()) : undefined
    if (!canonical) {
      return {
        ok: false,
        error: requested
          ? `Unknown budget category "${requested}". Use one of: ${categoryNames.join(', ')}.`
          : 'Every split line needs a category.',
        splits: [],
        totalCents: 0,
        transactionCents
      }
    }

    const amount = Number(line.amount)
    if (!Number.isFinite(amount) || cents(amount) <= 0) {
      return {
        ok: false,
        error: `Split amounts must be greater than zero ("${canonical}" had ${line.amount ?? 'no amount'}).`,
        splits: [],
        totalCents: 0,
        transactionCents
      }
    }

    const existing = merged.get(canonical)
    if (existing) existing.amount = (cents(existing.amount) + cents(amount)) / 100
    else merged.set(canonical, { category: canonical, amount: cents(amount) / 100 })
  }

  const splits = [...merged.values()]
  const totalCents = splits.reduce((s, line) => s + cents(line.amount), 0)
  if (totalCents !== transactionCents) {
    return {
      ok: false,
      error: `Split total $${(totalCents / 100).toFixed(2)} does not match the transaction amount $${transactionTotal}.`,
      splits,
      totalCents,
      transactionCents
    }
  }

  return { ok: true, splits, totalCents, transactionCents }
}
