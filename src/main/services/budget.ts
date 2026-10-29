import { getDb } from '../db'
import type { BudgetStatus, CardMapping, Category, CategoryRule, UnmatchedMerchant } from '@shared/types'
import { monthlyAmount } from '@shared/frequency'
import { parseBudgetCsv, parseBudgetText } from './csv'
import { REAL_TX } from './filters'
import { currentCycleRange } from './cycle'
import { netSpend, round2 } from './reconcile-math'

export { parseBudgetCsv }

type ImportOutcome = {
  imported: number
  skipped: number
  skippedSample: string[]
  categories: Category[]
}

function upsertBudgetRows(rows: Array<{ category: string; monthlyBudget: number }>): Category[] {
  const db = getDb()
  const now = Date.now()
  const upsert = db.prepare(
    `INSERT INTO categories (name, amount, frequency, updated_at) VALUES (?, ?, 'monthly', ?)
     ON CONFLICT(name) DO UPDATE SET amount = excluded.amount, frequency = excluded.frequency, updated_at = excluded.updated_at`
  )
  const tx = db.transaction(() => {
    for (const p of rows) upsert.run(p.category, p.monthlyBudget, now)
  })
  tx()
  return listCategories()
}

/** Parse + persist a CSV budget. */
export function importBudgetCsv(text: string): ImportOutcome {
  const { rows, skipped } = parseBudgetCsv(text)
  return {
    imported: rows.length,
    skipped: skipped.length,
    skippedSample: skipped.slice(0, 5),
    categories: upsertBudgetRows(rows)
  }
}

/** Parse + persist OCR text (a photo/screenshot of a budget table). */
export function importBudgetOcr(text: string): ImportOutcome {
  const { rows, skipped } = parseBudgetText(text)
  return {
    imported: rows.length,
    skipped: skipped.length,
    skippedSample: skipped.slice(0, 5),
    categories: upsertBudgetRows(rows)
  }
}

export function listCategories(): Category[] {
  const rows = getDb()
    .prepare('SELECT name, amount, frequency, color, split, active_from FROM categories ORDER BY name COLLATE NOCASE')
    .all() as Array<{ name: string; amount: number; frequency: string; color: string | null; split: number; active_from: string | null }>
  return rows.map((r) => ({
    name: r.name,
    amount: r.amount,
    frequency: r.frequency || 'monthly',
    color: r.color,
    split: r.split === 1,
    activeFrom: r.active_from ?? null
  }))
}

export function setCategoryBudget(name: string, amount: number, frequency = 'monthly'): Category[] {
  getDb()
    .prepare(
      'INSERT INTO categories (name, amount, frequency, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET amount = excluded.amount, frequency = excluded.frequency, updated_at = excluded.updated_at'
    )
    .run(name, amount, frequency, Date.now())
  return listCategories()
}

export function setCategorySplit(name: string, split: boolean): Category[] {
  getDb().prepare('UPDATE categories SET split = ? WHERE name = ?').run(split ? 1 : 0, name)
  return listCategories()
}

export function setCategoryActiveFrom(name: string, date: string): Category[] {
  getDb()
    .prepare('UPDATE categories SET active_from = ? WHERE name = ?')
    .run(date.trim() || null, name)
  return listCategories()
}

export function deleteCategory(name: string): Category[] {
  getDb().prepare('DELETE FROM categories WHERE name = ?').run(name)
  return listCategories()
}

export function clearCategories(): Category[] {
  getDb().prepare('DELETE FROM categories').run()
  return listCategories()
}

// ---------------------------------------------------------------------------
// Category matching
// ---------------------------------------------------------------------------

const KEYWORDS: Record<string, string[]> = {
  Groceries: ['countdown', 'new world', 'paknsave', 'pak n save', 'woolworths', 'supermarket', 'freshchoice', 'kosco'],
  Dining: ['mcdonalds', 'kfc', 'burger', 'cafe', 'coffee', 'dominos', 'pizza', 'sushi', 'restaurant', 'uber eats', 'doordash', 'takeaway', 'meal kit'],
  Transport: ['z energy', 'bp ', 'caltex', 'mobil', 'gull', 'petrol', 'fuel', 'gas station', 'uber', 'toll', 'bus', 'parking'],
  Utilities: ['power', 'electric', 'genesis', 'meridian', 'contact energy', 'trustpower', 'slingshot', 'spark', 'one nz', 'vodafone', '2degrees', 'internet', 'water', 'rocket mobile'],
  Rent: ['rent', 'landlord', 'property'],
  Entertainment: ['netflix', 'spotify', 'disney', 'youtube', 'prime video', 'neon', 'steam', 'playstation', 'xbox', 'cinema', 'event', 'aliexpress'],
  Insurance: ['insurance', 'aia', 'amp', 'fidelity life', 'southern cross', 'aa insurance', 'state insurance', 'ami', 'tower insurance'],
  Health: ['pharmacy', 'chemist', 'doctor', 'dental', 'gp ', 'medical', 'gym', 'fitness'],
  Subscriptions: ['subscription', 'membership', 'adobe', 'canva', 'icloud', 'google one', 'microsoft'],
  // User-specific budget categories (standing-order descriptions are truncated).
  'Jiu-jitsu': ['bjj', 'groundwork', 'jiu jitsu', 'jiu'],
  'AIA Vitality Fee': ['vitality'],
  'Band Room Rent': ['band room', 'bandroom'],
  'Home Insurance': ['house insur', 'house insurance', 'home insur', 'home insurance'],
  Mortgage: ['mortgage'],
  Rates: ['rates', 'council']
}

/** Normalise a description/merchant string for keyword matching. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

// --- User-defined category rules -------------------------------------------

export function listRules(): CategoryRule[] {
  return getDb().prepare('SELECT id, keyword, category FROM category_rules ORDER BY id').all() as CategoryRule[]
}

export function addRule(keyword: string, category: string): CategoryRule[] {
  const k = norm(keyword)
  const db = getDb()
  db.prepare('DELETE FROM category_rules WHERE keyword = ?').run(k)
  db.prepare('INSERT INTO category_rules (keyword, category, created_at) VALUES (?, ?, ?)').run(k, category, Date.now())
  return listRules()
}

export function removeRule(id: number): CategoryRule[] {
  getDb().prepare('DELETE FROM category_rules WHERE id = ?').run(id)
  return listRules()
}

// --- Card -> envelope mappings ---------------------------------------------
// A physical card (e.g. "0759") can be pinned to a budget envelope so its
// transactions resolve correctly even when the merchant text is unrecognised.

export function listCardMappings(): CardMapping[] {
  return getDb().prepare('SELECT card, category FROM card_mappings ORDER BY card').all() as CardMapping[]
}

export function setCardMapping(card: string, category: string): CardMapping[] {
  const c = card.replace(/\D/g, '')
  if (!c) return listCardMappings()
  getDb()
    .prepare(
      'INSERT INTO card_mappings (card, category, created_at) VALUES (?, ?, ?) ON CONFLICT(card) DO UPDATE SET category = excluded.category'
    )
    .run(c, category, Date.now())
  return listCardMappings()
}

export function removeCardMapping(card: string): CardMapping[] {
  getDb().prepare('DELETE FROM card_mappings WHERE card = ?').run(card.replace(/\D/g, ''))
  return listCardMappings()
}

/** Transactions (id, date, description) whose text matches a keyword. */
export function findTransactionsByKeyword(
  keyword: string,
  limit = 50
): Array<{ id: string; date: string; description: string; amount: number }> {
  const like = `%${keyword.toLowerCase()}%`
  return getDb()
    .prepare(
      `SELECT id, date, description, amount FROM transactions
       WHERE lower(description) LIKE ? ORDER BY date DESC LIMIT ?`
    )
    .all(like, limit) as Array<{ id: string; date: string; description: string; amount: number }>
}

function matchRule(needle: string, merchantNorm: string): string | null {
  const cNeedle = compact(needle)
  const cMerchant = compact(merchantNorm ?? '')
  for (const r of listRules()) {
    const cKeyword = compact(r.keyword)
    const textMatch = needle.includes(r.keyword) || (merchantNorm && merchantNorm.includes(r.keyword))
    // Compact match ignores punctuation/spacing so account numbers like
    // "12-3147-0423618-01" match a rule "123147042361801".
    const compactMatch = cKeyword.length >= 4 && (cNeedle.includes(cKeyword) || cMerchant.includes(cKeyword))
    if (textMatch || compactMatch) return r.category
  }
  return null
}

/** Lowercase and strip all non-alphanumerics (for account-number matching). */
function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Map a transaction (description + merchant + Akahu category) onto a budget
 * category name. Returns null when no budget category matches.
 */
export function matchCategory(description: string, merchant: string | null, akahuCategory: string | null): string | null {
  const budgetCats = listCategories().map((c) => c.name)
  if (budgetCats.length === 0) return null

  const needle = norm(description)
  const merchantNorm = merchant ? norm(merchant) : ''
  const akahu = akahuCategory ? norm(akahuCategory) : ''

  // 0. User-defined rules (highest priority).
  const rule = matchRule(needle, merchantNorm)
  if (rule && budgetCats.includes(rule)) return rule

  // 1. Direct match on the Akahu category name.
  if (akahu) {
    const hit = budgetCats.find((c) => norm(c) === akahu)
    if (hit) return hit
  }

  // 2. Keyword map -> budget category (match category name by containment).
  for (const [cat, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some((k) => needle.includes(norm(k)))) {
      const ncat = norm(cat)
      const hit =
        budgetCats.find((c) => norm(c) === ncat) ??
        budgetCats.find((c) => norm(c).includes(ncat) || ncat.includes(norm(c)))
      if (hit) return hit
    }
  }

  // 3. Fuzzy contains match (whole name or significant words).
  const contains = budgetCats.find((c) => {
    const cn = norm(c)
    if (cn.length > 2 && (needle.includes(cn) || cn.includes(needle) || (akahu && akahu.includes(cn)))) return true
    return cn.split(' ').some((w) => w.length >= 5 && needle.includes(w))
  })
  if (contains) return contains

  // 4. Card -> envelope mapping (e.g. "CARD 0759" → Spending Money).
  const card = /(?:card)\s*(\d{3,4})/i.exec(needle)
  if (card) {
    const row = getDb().prepare('SELECT category FROM card_mappings WHERE card = ?').get(card[1]) as
      | { category: string }
      | undefined
    if (row && budgetCats.includes(row.category)) return row.category
  }

  return null
}

/** Names of categories that are split 50/50 with a partner. */
export function getSplitCategories(): Set<string> {
  return new Set(listCategories().filter((c) => c.split).map((c) => c.name))
}

/** Total incoming reimbursements for split categories in a date range. */
export function totalReimbursements(start: string, end: string): number {
  const split = getSplitCategories()
  if (split.size === 0) return 0
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT description, merchant, amount, category FROM transactions
       WHERE ${REAL_TX} AND amount > 0 AND date >= ? AND date < ?`
    )
    .all(start, end) as Array<{ description: string; merchant: string | null; amount: number; category: string | null }>
  let total = 0
  for (const r of rows) {
    const c = matchCategory(r.description, r.merchant, r.category)
    if (c && split.has(c)) total += r.amount
  }
  return round2(total)
}

/** Compute per-category spend for a date range [start, end) against budgets. */
export function computeBudgetStatus(start: string, end: string): BudgetStatus[] {
  const db = getDb()
  const categories = listCategories()
  const split = getSplitCategories()

  // Per-category "active from" date — spend before it is ignored for that item.
  const activeFromMap = new Map<string, string>()
  for (const c of categories) if (c.activeFrom) activeFromMap.set(c.name, c.activeFrom)

  const rows = db
    .prepare(
      `SELECT date, description, merchant, amount, category FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?`
    )
    .all(start, end) as Array<{ date: string; description: string; merchant: string | null; amount: number; category: string | null }>

  const incoming = split.size > 0
    ? (db
        .prepare(
          `SELECT description, merchant, amount, category FROM transactions
           WHERE ${REAL_TX} AND amount > 0 AND date >= ? AND date < ?`
        )
        .all(start, end) as Array<{ description: string; merchant: string | null; amount: number; category: string | null }>)
    : []

  const spent = new Map<string, number>()
  const reimbursed = new Map<string, number>()
  const unmatched = new Map<string, number>()

  for (const r of rows) {
    const c = matchCategory(r.description, r.merchant, r.category)
    if (c) {
      const af = activeFromMap.get(c)
      if (af && r.date < af) continue
      spent.set(c, (spent.get(c) ?? 0) + Math.abs(r.amount))
    } else {
      unmatched.set('Uncategorised', (unmatched.get('Uncategorised') ?? 0) + Math.abs(r.amount))
    }
  }

  // Net incoming reimbursements against split categories.
  for (const r of incoming) {
    const c = matchCategory(r.description, r.merchant, r.category)
    if (c && split.has(c)) reimbursed.set(c, (reimbursed.get(c) ?? 0) + r.amount)
  }

  const status: BudgetStatus[] = categories.map((c) => {
    const gross = spent.get(c.name) ?? 0
    const back = reimbursed.get(c.name) ?? 0
    const s = netSpend(gross, back, c.split)
    const budget = monthlyAmount(c.amount, c.frequency)
    return {
      category: c.name,
      budgeted: round2(budget),
      spent: round2(s),
      remaining: round2(budget - s),
      percent: budget > 0 ? (s / budget) * 100 : 0
    }
  })

  if (unmatched.size > 0) {
    for (const [name, s] of unmatched) {
      status.push({
        category: name,
        budgeted: 0,
        spent: round2(s),
        remaining: round2(-s),
        percent: 0
      })
    }
  }

  return status
}

/** Group unmatched spending into merchants so the user can map them. */
export function listUnmatchedMerchants(limit = 40): UnmatchedMerchant[] {
  const db = getDb()
  const { start, end } = currentCycleRange()
  const rows = db
    .prepare(
      `SELECT merchant, description, amount FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?`
    )
    .all(start, end) as Array<{ merchant: string | null; description: string; amount: number }>

  const groups = new Map<string, { label: string; count: number; total: number }>()
  for (const r of rows) {
    if (matchCategory(r.description, r.merchant, null)) continue
    const key = merchantKey(r)
    const g = groups.get(key) ?? { label: r.merchant ?? r.description, count: 0, total: 0 }
    g.count += 1
    g.total += Math.abs(r.amount)
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, count: g.count, total: round2(g.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

function merchantKey(r: { merchant: string | null; description: string }): string {
  if (r.merchant) return norm(r.merchant)
  // Use the full description so distinct payees don't collapse under a
  // generic prefix (e.g. every "TFR TO …" grouped as "tfr to").
  return norm(r.description)
}

/** Individual unmatched (uncategorised) transactions in the current cycle. */
export function listUnmatchedTransactions(
  limit = 10
): Array<{ id: string; date: string; description: string; merchant: string | null; amount: number }> {
  const db = getDb()
  const { start, end } = currentCycleRange()
  const rows = db
    .prepare(
      `SELECT id, date, description, merchant, amount FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?
       ORDER BY date DESC LIMIT ?`
    )
    .all(start, end, limit) as Array<{
    id: string
    date: string
    description: string
    merchant: string | null
    amount: number
  }>
  return rows.filter((r) => !matchCategory(r.description, r.merchant, null))
}

