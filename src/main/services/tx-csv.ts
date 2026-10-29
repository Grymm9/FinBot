/**
 * Bank-statement CSV parsing (pure: no DB or Electron imports).
 *
 * Akahu is optional now, so a statement export is the fallback source of real
 * transactions. NZ banks disagree on column names and date formats, so the
 * parser detects columns by header name and accepts ISO, day-first and
 * month-name dates. Amounts keep their sign: negative = money out, which is
 * what the rest of the app assumes.
 *
 * Unrecognised headers fall back to (date, description, amount) in the first
 * three columns.
 */

/**
 * Statement amounts: keep the sign, accept currency symbols, thousands
 * separators, and the "(120.00)" negative convention.
 */
function amountFrom(raw: string | undefined): number | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const negative = /^\(.*\)$/.test(value) || /-\s*$/.test(value)
  const cleaned = value
    .replace(/[^0-9.,\-]/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/,/g, '.')
  const match = cleaned.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  let n = Number(match[0])
  if (negative && n > 0) n = -n
  return Number.isFinite(n) ? n : null
}

export interface ParsedTransactionRow {
  date: string
  description: string
  amount: number
  type: string | null
  account: string | null
}

export interface TxCsvResult {
  rows: ParsedTransactionRow[]
  skipped: string[]
  /** Which header was used for each field (null when falling back by position). */
  columns: {
    date: string | null
    description: string | null
    amount: string | null
    account: string | null
  }
}

const DATE_HEADERS = ['date', 'transactiondate', 'valuedate', 'posteddate', 'processeddate']
const DESC_HEADERS = [
  'description',
  'details',
  'particulars',
  'payee',
  'merchant',
  'narrative',
  'memo',
  'reference',
  'transactiondescription'
]
const AMOUNT_HEADERS = ['amount', 'transactionamount', 'value', 'netamount']
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals', 'moneyout', 'debitamount']
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits', 'moneyin', 'creditamount']
const ACCOUNT_HEADERS = ['account', 'accountname', 'accountnumber']
const TYPE_HEADERS = ['type', 'transactiontype', 'details type']

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/** Split CSV text into records, honouring quotes and quoted newlines. */
export function parseCsvRecords(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      // Treat CRLF as one break.
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function iso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200) return null
  if (month < 1 || month > 12) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > daysInMonth) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Parse the common statement date formats into `YYYY-MM-DD`.
 *
 * Slash/dot dates are read day-first (NZ convention) unless the first number
 * cannot be a day, in which case month-first is used.
 */
export function parseStatementDate(raw: string | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null

  // 2026-10-13 (optionally with a time)
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))

  // 13/10/2026, 13-10-26, 13.10.2026
  const numeric = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/)
  if (numeric) {
    let day = Number(numeric[1])
    let month = Number(numeric[2])
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])
    if (day <= 12 && month > 12) {
      // Clearly month-first (10/13/2026).
      ;[day, month] = [month, day]
    }
    return iso(year, month, day)
  }

  // 13 Oct 2026 / 13 October 2026 / 13 October, 2026
  const dayFirst = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/)
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].slice(0, 4).toLowerCase()] ?? MONTHS[dayFirst[2].slice(0, 3).toLowerCase()]
    if (month) return iso(Number(dayFirst[3]), month, Number(dayFirst[1]))
  }

  // Oct 13, 2026
  const monthFirst = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].slice(0, 4).toLowerCase()] ?? MONTHS[monthFirst[1].slice(0, 3).toLowerCase()]
    if (month) return iso(Number(monthFirst[3]), month, Number(monthFirst[2]))
  }

  return null
}

function pickColumn(header: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = header.findIndex((h) => normalise(h) === candidate)
    if (idx !== -1) return idx
  }
  return -1
}

function allColumns(header: string[], candidates: string[]): number[] {
  return header
    .map((h, i) => (candidates.includes(normalise(h)) ? i : -1))
    .filter((i) => i !== -1)
}

export function parseTransactionCsv(text: string): TxCsvResult {
  const records = parseCsvRecords(text)
  if (records.length === 0) {
    return { rows: [], skipped: [], columns: { date: null, description: null, amount: null, account: null } }
  }

  const header = records[0].map((h) => h.trim())
  const hasHeader = header.some((h) => {
    const n = normalise(h)
    return (
      DATE_HEADERS.includes(n) ||
      DESC_HEADERS.includes(n) ||
      AMOUNT_HEADERS.includes(n) ||
      DEBIT_HEADERS.includes(n) ||
      CREDIT_HEADERS.includes(n) ||
      n === 'date' ||
      n === 'amount'
    )
  })

  const dataRows = hasHeader ? records.slice(1) : records

  let dateIdx = hasHeader ? pickColumn(header, DATE_HEADERS) : 0
  const descIdx = hasHeader ? allColumns(header, DESC_HEADERS) : [1]
  const amountIdx = hasHeader ? pickColumn(header, AMOUNT_HEADERS) : 2
  const debitIdx = hasHeader ? pickColumn(header, DEBIT_HEADERS) : -1
  const creditIdx = hasHeader ? pickColumn(header, CREDIT_HEADERS) : -1
  const accountIdx = hasHeader ? pickColumn(header, ACCOUNT_HEADERS) : -1
  const typeIdx = hasHeader ? pickColumn(header, TYPE_HEADERS) : -1

  // No usable headers at all: treat the first column as the date.
  if (dateIdx === -1) dateIdx = 0

  const rows: ParsedTransactionRow[] = []
  const skipped: string[] = []

  for (const record of dataRows) {
    const rawLine = record.join(',').slice(0, 200)
    const date = parseStatementDate(record[dateIdx])
    if (!date) {
      skipped.push(rawLine)
      continue
    }

    let amount: number | null = null
    if (debitIdx !== -1 || creditIdx !== -1) {
      const debit = amountFrom(debitIdx !== -1 ? record[debitIdx] : undefined)
      const credit = amountFrom(creditIdx !== -1 ? record[creditIdx] : undefined)
      if (debit !== null || credit !== null) {
        // Bank exports list the debit as a positive number in its own column.
        amount = (credit ?? 0) - Math.abs(debit ?? 0)
      }
    } else {
      amount = amountFrom(record[amountIdx])
    }
    if (amount === null || !Number.isFinite(amount)) {
      skipped.push(rawLine)
      continue
    }

    const description = descIdx
      .map((i) => (record[i] ?? '').trim())
      .filter(Boolean)
      .filter((part, i, all) => all.indexOf(part) === i)
      .slice(0, 3)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!description) {
      skipped.push(rawLine)
      continue
    }

    rows.push({
      date,
      description,
      amount: Math.round(amount * 100) / 100,
      type: typeIdx !== -1 ? (record[typeIdx] ?? '').trim() || null : null,
      account: accountIdx !== -1 ? (record[accountIdx] ?? '').trim() || null : null
    })
  }

  // Without a header row there are no column names to report: everything came
  // from positional fallbacks.
  if (!hasHeader) {
    return { rows, skipped, columns: { date: null, description: null, amount: null, account: null } }
  }

  return {
    rows,
    skipped,
    columns: {
      date: dateIdx !== -1 ? header[dateIdx] ?? null : null,
      description: descIdx.length > 0 ? header[descIdx[0]] ?? null : null,
      amount:
        debitIdx !== -1 || creditIdx !== -1
          ? [debitIdx, creditIdx]
              .filter((i) => i !== -1)
              .map((i) => header[i])
              .join(' / ')
          : amountIdx !== -1
            ? header[amountIdx] ?? null
            : null,
      account: accountIdx !== -1 ? header[accountIdx] ?? null : null
    }
  }
}
