import { readFile, copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import pdf from 'pdf-parse'
import { app, shell } from 'electron'
import { getDb } from '../db'
import { monthlyAmount } from '@shared/frequency'
import { localIsoDate } from './dates'
import type { InsuranceBundle, InsurancePolicy } from '@shared/types'

const KNOWN_PROVIDERS = [
  'AA Insurance',
  'State Insurance',
  'AMI Insurance',
  'Tower Insurance',
  'AIA',
  'Fidelity Life',
  'Southern Cross',
  'Asteron Life',
  'Partners Life',
  'Cigna',
  'Nib',
  'MAS',
  'Vero',
  'FMG',
  'Ando'
]

const COVER_KEYWORDS: Array<[string, string[]]> = [
  ['Home & Contents', ['home', 'contents', 'house']],
  ['Motor Vehicle', ['motor', 'vehicle', 'car', 'comprehensive']],
  ['Life', ['life cover', 'life insurance', 'term life']],
  ['Health', ['health insurance', 'medical insurance', 'surgical']],
  ['Income Protection', ['income protection', 'mortgage repayment', 'disability']],
  ['Contents', ['contents']],
  ['Home', ['home', 'house']],
  ['Travel', ['travel']]
]

/**
 * Extract raw text from a PDF using pdf-parse (pdf.js under the hood).
 * Returns null if extraction fails so callers can fall back to manual entry.
 */
export async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath)
    const data = await pdf(buf)
    return data.text ?? null
  } catch (e) {
    console.error('PDF extraction failed:', e)
    return null
  }
}

interface Extracted {
  provider: string | null
  coverType: string | null
  premium: number | null
  renewalDate: string | null
}

/** Parse policy metadata from raw PDF text using NZ-specific heuristics. */
export function parsePolicy(text: string): Extracted {
  const provider =
    KNOWN_PROVIDERS.find((p) => text.toLowerCase().includes(p.toLowerCase())) ??
    (/(?:from|provider|insurer|underwritten by)[:.\s]*([A-Z][A-Za-z&.\- ]{3,40})/i.exec(text)?.[1]?.trim() ?? null)

  const coverType =
    COVER_KEYWORDS.find(([, kws]) => kws.some((k) => text.toLowerCase().includes(k)))?.[0] ?? null

  const premium = extractPremium(text)
  const renewalDate = extractDate(text)

  return { provider, coverType, premium, renewalDate }
}

function extractPremium(text: string): number | null {
  // Broad set of patterns for "amount to pay": total payable, amount due,
  // premium, and "$X.XX per month/fortnight/year".
  const patterns = [
    /(?:total\s+)?amount\s+(?:payable|due)[^$€£]{0,40}?[$€£]?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:annual\s+|monthly\s+|fortnightly\s+|weekly\s+)?premium[^$€£]{0,40}?[$€£]?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:total|balance|amount)\s+(?:due|payable)[^$€£]{0,40}?[$€£]?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:pay|payable|due|payment)[^$€£]{0,30}?[$€£]\s*([\d,]+(?:\.\d{1,2})?)/i,
    /[$€£]\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per\s+)?(?:month|annual|year|annum|fortnight|week)/i
  ]
  for (const p of patterns) {
    const m = p.exec(text)
    if (m) {
      const n = Number(m[1].replace(/,/g, ''))
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

function extractDate(text: string): string | null {
  const patterns = [
    /(?:renewal\s+date|expiry|due\s+date|due\s+by|renewed\s+on|renewal|payment\s+due|pay\s+by)[:\s]*([0-9]{1,2}[ /.-][A-Za-z]{3,9}[ /.-][0-9]{2,4})/i,
    /([0-9]{1,2}[ /.-][A-Za-z]{3,9}[ /.-][0-9]{4})/
  ]
  for (const p of patterns) {
    const m = p.exec(text)
    if (m) {
      const d = new Date(m[1].replace(/[ /.-]/g, ' '))
      if (!Number.isNaN(d.getTime())) return localIsoDate(d)
    }
  }
  return null
}

/** Import many PDF policies at once. Returns the count and resulting policies. */
export async function importPolicyPdfs(
  filePaths: string[]
): Promise<{ imported: number; policies: InsurancePolicy[] }> {
  const policies: InsurancePolicy[] = []
  let imported = 0
  for (const fp of filePaths) {
    try {
      policies.push(await importPolicyPdf(fp))
      imported++
    } catch (e) {
      console.error('PDF import failed:', fp, e)
    }
  }
  return { imported, policies }
}

/** Import a PDF policy: extract text, parse metadata, persist. */
export async function importPolicyPdf(filePath: string): Promise<InsurancePolicy> {
  const text = await extractPdfText(filePath)
  if (!text) {
    const id = insertPolicy({ provider: null, coverType: null, premium: null, renewalDate: null }, basename(filePath), null)
    return getPolicy(id)!
  }

  const parsed = parsePolicy(text)
  const id = insertPolicy(parsed, basename(filePath), text)
  return getPolicy(id)!
}

function insertPolicy(parsed: Extracted, source: string, text: string | null): number {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO insurance_policies (provider, cover_type, premium, renewal_date, source_file, extracted_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      parsed.provider,
      parsed.coverType,
      parsed.premium,
      parsed.renewalDate,
      source,
      text ? JSON.stringify(parsed) : null,
      Date.now()
    )
  return Number(info.lastInsertRowid)
}

/**
 * Import a policy from free-form text (e.g. an email body). Returns the new
 * policy, or null if no insurance metadata could be extracted.
 */
export function importPolicyFromText(text: string, source: string): InsurancePolicy | null {
  const parsed = parsePolicy(text)
  if (!parsed.provider && !parsed.premium && !parsed.renewalDate) return null
  const id = insertPolicy(parsed, source, text)
  return getPolicy(id)!
}

export function listPolicies(): InsurancePolicy[] {
  const rows = getDb()
    .prepare(
      `SELECT id, provider, cover_type, premium, frequency, renewal_date, source_file, linked_transaction_id, extracted_json
       FROM insurance_policies ORDER BY created_at DESC`
    )
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    provider: (r.provider as string) ?? null,
    coverType: (r.cover_type as string) ?? null,
    premium: (r.premium as number) ?? null,
    frequency: (r.frequency as string) ?? null,
    renewalDate: (r.renewal_date as string) ?? null,
    sourceFile: (r.source_file as string) ?? null,
    linkedTransactionId: (r.linked_transaction_id as string) ?? null,
    extracted: !!(r.extracted_json as string),
    extractionError: null
  }))
}

export function getPolicy(id: number): InsurancePolicy | null {
  return listPolicies().find((p) => p.id === id) ?? null
}

export function updatePolicy(
  id: number,
  fields: {
    provider?: string
    coverType?: string
    premium?: number
    frequency?: string
    renewalDate?: string
  }
): InsurancePolicy {
  getDb()
    .prepare(
      `UPDATE insurance_policies SET provider = COALESCE(?, provider), cover_type = COALESCE(?, cover_type),
       premium = COALESCE(?, premium), frequency = COALESCE(?, frequency), renewal_date = COALESCE(?, renewal_date) WHERE id = ?`
    )
    .run(
      fields.provider ?? null,
      fields.coverType ?? null,
      fields.premium ?? null,
      fields.frequency ?? null,
      fields.renewalDate ?? null,
      id
    )
  return getPolicy(id)!
}

export function deletePolicy(id: number): void {
  getDb().prepare('DELETE FROM insurance_policies WHERE id = ?').run(id)
}

/**
 * Link policies to actual bank debit transactions by matching provider name
 * in the transaction description and premium within a tolerance window.
 */
export function linkPoliciesToTransactions(): { linked: number } {
  const db = getDb()
  const policies = listPolicies()
  const txRows = db
    .prepare('SELECT id, description, amount, date FROM transactions WHERE amount < 0')
    .all() as Array<{ id: string; description: string; amount: number; date: string }>

  const link = db.prepare('UPDATE insurance_policies SET linked_transaction_id = ? WHERE id = ?')
  let linked = 0

  for (const p of policies) {
    if (!p.provider || p.premium == null) continue
    const provider = p.provider.toLowerCase()
    const match = txRows.find((t) => {
      const desc = t.description.toLowerCase()
      const amountMatches = Math.abs(Math.abs(t.amount) - p.premium!) <= Math.max(1, p.premium! * 0.05)
      return desc.includes(provider) && amountMatches
    })
    if (match) {
      link.run(match.id, p.id)
      linked += 1
    }
  }
  return { linked }
}

// ---------------------------------------------------------------------------
// Manual entry + PDF file storage
// ---------------------------------------------------------------------------

async function policyDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'policies')
  await mkdir(dir, { recursive: true })
  return dir
}

/** Copy a PDF into local policy storage; returns the stored filename. */
export async function storePolicyFile(filePath: string): Promise<{ name: string }> {
  const dir = await policyDir()
  const name = `${Date.now()}-${basename(filePath)}`
  await copyFile(filePath, join(dir, name))
  return { name }
}

/** Attach a PDF to an existing policy (stores the file, updates source_file). */
export async function attachPdfToPolicy(id: number, filePath: string): Promise<InsurancePolicy> {
  const { name } = await storePolicyFile(filePath)
  getDb().prepare('UPDATE insurance_policies SET source_file = ? WHERE id = ?').run(name, id)
  return getPolicy(id)!
}

/** Open a stored policy PDF with the system viewer. */
export async function openPolicyFile(id: number): Promise<{ ok: boolean; error?: string }> {
  const p = getPolicy(id)
  if (!p?.sourceFile) return { ok: false, error: 'No file attached.' }
  const full = join(await policyDir(), p.sourceFile)
  const err = await shell.openPath(full)
  return err ? { ok: false, error: err } : { ok: true }
}

/** Create a policy manually (provider, premium, deduction/renewal date). */
export function createPolicy(fields: {
  provider?: string | null
  coverType?: string | null
  premium?: number | null
  frequency?: string | null
  renewalDate?: string | null
  sourceFile?: string | null
}): InsurancePolicy {
  const parsed = {
    provider: fields.provider ?? null,
    coverType: fields.coverType ?? null,
    premium: fields.premium ?? null,
    frequency: fields.frequency ?? null,
    renewalDate: fields.renewalDate ?? null
  }
  const info = getDb()
    .prepare(
      `INSERT INTO insurance_policies (provider, cover_type, premium, frequency, renewal_date, source_file, extracted_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      parsed.provider,
      parsed.coverType,
      parsed.premium,
      parsed.frequency,
      parsed.renewalDate,
      fields.sourceFile ?? null,
      JSON.stringify(parsed),
      Date.now()
    )
  return getPolicy(Number(info.lastInsertRowid))!
}

/** Manually link a policy to a specific bank debit transaction. */
export function linkPolicyToTransaction(policyId: number, transactionId: string): InsurancePolicy {
  getDb().prepare('UPDATE insurance_policies SET linked_transaction_id = ? WHERE id = ?').run(transactionId, policyId)
  return getPolicy(policyId)!
}

/** Unlink a policy from its transaction. */
export function unlinkPolicy(policyId: number): InsurancePolicy {
  getDb().prepare('UPDATE insurance_policies SET linked_transaction_id = NULL WHERE id = ?').run(policyId)
  return getPolicy(policyId)!
}

/** Recent debit transactions (candidates for manual policy matching). */
export function listDeductions(limit = 500): Array<{
  id: string
  date: string
  description: string
  amount: number
  account: string
}> {
  return getDb()
    .prepare(
      `SELECT t.id, t.date, t.description, t.amount, a.name AS account
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id IN (SELECT id FROM accounts WHERE enabled = 1)
         AND (t.type IS NULL OR t.type != 'TRANSFER')
         AND t.amount < 0
       ORDER BY t.date DESC LIMIT ?`
    )
    .all(limit) as Array<{ id: string; date: string; description: string; amount: number; account: string }>
}

// ---------------------------------------------------------------------------
// Policy bundles (group several policies, e.g. a household insurance package)
// ---------------------------------------------------------------------------

interface BundlePolicyRow {
  bundle_id: number
  policy_id: number
  provider: string | null
  cover_type: string | null
  premium: number | null
  frequency: string | null
  source_file: string | null
}

export function listBundles(): InsuranceBundle[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT bi.bundle_id, bi.policy_id, p.provider, p.cover_type, p.premium, p.frequency, p.source_file
       FROM insurance_bundle_items bi
       JOIN insurance_policies p ON p.id = bi.policy_id
       ORDER BY bi.bundle_id, p.id`
    )
    .all() as BundlePolicyRow[]

  const bundleIds = db
    .prepare('SELECT id, name, linked_transaction_id, source_file FROM insurance_bundles ORDER BY id')
    .all() as Array<{
    id: number
    name: string | null
    linked_transaction_id: string | null
    source_file: string | null
  }>

  const itemsByBundle = new Map<number, InsuranceBundle['items']>()
  for (const r of rows) {
    const list = itemsByBundle.get(r.bundle_id) ?? []
    const monthly = r.premium != null ? round2(monthlyAmount(r.premium, r.frequency ?? 'monthly')) : 0
    list.push({
      policyId: r.policy_id,
      provider: r.provider,
      coverType: r.cover_type,
      premium: r.premium,
      frequency: r.frequency,
      monthly,
      sourceFile: r.source_file
    })
    itemsByBundle.set(r.bundle_id, list)
  }

  return bundleIds.map(({ id, name, linked_transaction_id, source_file }) => {
    const items = itemsByBundle.get(id) ?? []
    const monthlyTotal = round2(items.reduce((s, i) => s + i.monthly, 0))
    return { id, name, linkedTransactionId: linked_transaction_id, sourceFile: source_file, items, monthlyTotal }
  })
}

export function createBundle(name: string | null, policyIds: number[]): InsuranceBundle[] {
  const db = getDb()
  const info = db.prepare('INSERT INTO insurance_bundles (name, created_at) VALUES (?, ?)').run(name, Date.now())
  const id = Number(info.lastInsertRowid)
  const ins = db.prepare('INSERT OR IGNORE INTO insurance_bundle_items (bundle_id, policy_id) VALUES (?, ?)')
  for (const pid of policyIds) ins.run(id, pid)
  return listBundles()
}

export function addBundleItem(bundleId: number, policyId: number): InsuranceBundle[] {
  getDb()
    .prepare('INSERT OR IGNORE INTO insurance_bundle_items (bundle_id, policy_id) VALUES (?, ?)')
    .run(bundleId, policyId)
  return listBundles()
}

export function removeBundleItem(bundleId: number, policyId: number): InsuranceBundle[] {
  getDb().prepare('DELETE FROM insurance_bundle_items WHERE bundle_id = ? AND policy_id = ?').run(bundleId, policyId)
  return listBundles()
}

export function deleteBundle(id: number): InsuranceBundle[] {
  const db = getDb()
  db.prepare('DELETE FROM insurance_bundle_items WHERE bundle_id = ?').run(id)
  db.prepare('DELETE FROM insurance_bundles WHERE id = ?').run(id)
  return listBundles()
}

export function renameBundle(id: number, name: string): InsuranceBundle[] {
  getDb().prepare('UPDATE insurance_bundles SET name = ? WHERE id = ?').run(name.trim() || null, id)
  return listBundles()
}

/** Attach a single PDF to a bundle (one document covers all its policies). */
export async function attachPdfToBundle(bundleId: number, filePath: string): Promise<InsuranceBundle[]> {
  const { name } = await storePolicyFile(filePath)
  getDb().prepare('UPDATE insurance_bundles SET source_file = ? WHERE id = ?').run(name, bundleId)
  return listBundles()
}

/** Open a bundle's stored PDF with the system viewer. */
export async function openBundleFile(bundleId: number): Promise<{ ok: boolean; error?: string }> {
  const b = listBundles().find((x) => x.id === bundleId)
  if (!b?.sourceFile) return { ok: false, error: 'No file attached.' }
  const full = join(await policyDir(), b.sourceFile)
  const err = await shell.openPath(full)
  return err ? { ok: false, error: err } : { ok: true }
}

/** Manually link a bundle to a single bank debit transaction. */
export function linkBundleToTransaction(bundleId: number, transactionId: string): InsuranceBundle[] {
  getDb().prepare('UPDATE insurance_bundles SET linked_transaction_id = ? WHERE id = ?').run(transactionId, bundleId)
  return listBundles()
}

/** Unlink a bundle from its transaction. */
export function unlinkBundle(bundleId: number): InsuranceBundle[] {
  getDb().prepare('UPDATE insurance_bundles SET linked_transaction_id = NULL WHERE id = ?').run(bundleId)
  return listBundles()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
