// Pure CSV / OCR text parsing helpers (no Electron / DB dependencies) so they
// can be unit-tested in isolation.

export interface BudgetCsvResult {
  rows: Array<{ category: string; monthlyBudget: number }>
  skipped: string[]
}

const SKIP_NAMES = new Set([
  'total',
  'grand total',
  'total budget',
  'budget total',
  'subtotal',
  'notes',
  'category',
  'budget'
])

/** True for summary/aggregate rows (e.g. "Insurances Total", "Remaining"). */
function isSummaryName(name: string): boolean {
  const n = name.toLowerCase().trim()
  if (SKIP_NAMES.has(n)) return true
  return /\b(total|subtotal|remaining)\b/.test(n)
}

/**
 * Parse a budget CSV.
 *
 * Accepts a flexible CSV with an optional header row. Recognised header names
 * (case-insensitive, punctuation ignored) for the category column: `category`,
 * `name`, `label`, `budget category`. For the amount column: `budget`,
 * `amount`, `monthly`, `monthly budget`, `monthly amount`, `monthlybudget`.
 *
 * Handles:
 *  - UTF-8 BOM, quoted fields (commas/escaped quotes inside a field)
 *  - amounts with currency symbols/codes, thousands separators, spaces,
 *    parentheses for negatives, and trailing text (e.g. "800.00 per month")
 */
export function parseBudgetCsv(text: string): BudgetCsvResult {
  const lines = text
    .replace(/^\uFEFF/, '') // strip UTF-8 BOM
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return { rows: [], skipped: [] }

  const header = parseCsvLine(lines[0]).map((c) => c.trim())
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  // Find the first header column matching a candidate name, honouring the
  // priority order of the candidates (so "item" beats "category").
  const findCol = (...names: string[]): number => {
    for (const n of names) {
      const idx = header.findIndex((h) => norm(h) === n)
      if (idx !== -1) return idx
    }
    return -1
  }

  // Prefer the most specific line-item column: "Item" over "Category" over
  // "Name"/"Label". Many budget exports have both a group ("Category") and a
  // line item ("Item"); the item is what we want as the budget category name.
  let catIdx = findCol('item', 'category', 'name', 'label', 'budgetcategory')
  let amtIdx = findCol('budget', 'amount', 'monthly', 'monthlybudget', 'monthlyamount')
  let startRow = 1

  // No recognisable header? Assume columns are (category, budget).
  if (catIdx === -1 || amtIdx === -1) {
    catIdx = 0
    amtIdx = 1
    startRow = 0
  }

  const rows: Array<{ category: string; monthlyBudget: number }> = []
  const skipped: string[] = []

  for (let i = startRow; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]).map((c) => c.trim())
    const name = cols[catIdx]?.trim()
    if (!name) {
      skipped.push(lines[i])
      continue
    }
    if (isSummaryName(name)) {
      skipped.push(lines[i])
      continue
    }
    const amount = parseAmount(cols[amtIdx])
    if (amount === null) {
      skipped.push(lines[i])
      continue
    }
    rows.push({ category: name, monthlyBudget: amount })
  }
  return { rows, skipped }
}

/**
 * Parse free-form text produced by OCR (a photo/screenshot of a budget table)
 * into category + amount rows. Each line is expected to look like
 * "Groceries 800" or "Rent $2,200.00". Headers/totals are skipped.
 */
export function parseBudgetText(text: string): BudgetCsvResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const rows: Array<{ category: string; monthlyBudget: number }> = []
  const skipped: string[] = []

  for (const line of lines) {
    const parsed = extractCategoryAmount(line)
    if (!parsed) {
      skipped.push(line)
      continue
    }
    if (isSummaryName(parsed.category)) {
      skipped.push(line)
      continue
    }
    rows.push(parsed)
  }
  return { rows, skipped }
}

function extractCategoryAmount(
  line: string
): { category: string; monthlyBudget: number } | null {
  // Case 1: a parenthesised amount at the end of the line => negative value.
  const paren = line.match(/^(.*?)\s*\(([$€£]?\s*-?\d[\d,]*(?:\.\d+)?)\)\s*$/)
  if (paren) {
    const amount = parseAmount(paren[2])
    const category = cleanCategory(paren[1])
    if (amount !== null && category) {
      return { category, monthlyBudget: -Math.abs(amount) }
    }
  }

  // Case 2: an amount anchored at the end of the line.
  const end = line.match(/^(.*?)\s*([$€£]?\s*-?\d[\d,]*(?:\.\d+)?)\s*$/)
  if (end) {
    const amount = parseAmount(end[2])
    const category = cleanCategory(end[1])
    if (amount !== null && category) {
      return { category, monthlyBudget: amount }
    }
  }

  // Case 3: the last number found anywhere on the line.
  const nums = line.match(/[$€£]?\s*-?\d[\d,]*(?:\.\d+)?/g)
  if (!nums || nums.length === 0) return null
  const last = nums[nums.length - 1]
  const idx = line.lastIndexOf(last)
  const amount = parseAmount(last)
  if (amount === null) return null

  const category = cleanCategory(line.slice(0, idx))
  if (!category) return null
  return { category, monthlyBudget: amount }
}

function cleanCategory(s: string): string {
  return s
    .replace(/^[\s\-•*#_=|:]+/, '') // leading bullets/punctuation
    .replace(/^\d+[.)]?\s*/, '') // "1. Groceries" / "1) Groceries"
    .replace(/[\s$€£:;|]+$/, '') // trailing currency/punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse a single CSV line, honouring quoted fields and escaped quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** Parse a currency amount, tolerating symbols, separators and trailing text. */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null
  let s = raw.trim()
  if (s === '') return null

  const negative = /^\(.*\)$/.test(s) // "(120.00)" => negative
  s = s
    .replace(/[$€£]/g, '')
    .replace(/nzd/gi, '')
    .replace(/[,\s]/g, '')
    .replace(/[()]/g, '')

  const match = s.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  let n = Number(match[0])
  if (negative) n = -n
  return Number.isFinite(n) ? n : null
}
