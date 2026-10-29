import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Account, Category, TransactionSearchResult } from '@shared/types'
import { Badge, Button, Card, EmptyState, SectionHeader, Spinner } from './ui'
import { money, shortDate } from '../lib/format'

const fieldCls =
  'rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none'

export default function Transactions(): JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [accountId, setAccountId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [result, setResult] = useState<TransactionSearchResult | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [importAccount, setImportAccount] = useState('')
  const [importNote, setImportNote] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void window.api.listCategories().then(setCategories)
    void window.api.listAccounts().then(setAccounts)
  }, [])

  const search = useCallback(async () => {
    setLoading(true)
    try {
      const r = await window.api.searchTransactions({
        query,
        category,
        accountId,
        from: from || undefined,
        to: to || undefined,
        limit: 300
      })
      setResult(r)
    } finally {
      setLoading(false)
    }
  }, [query, category, accountId, from, to])

  // Debounce so typing doesn't hammer the database.
  useEffect(() => {
    const t = setTimeout(() => void search(), 250)
    return () => clearTimeout(t)
  }, [search])

  const categoryOptions = useMemo(
    () => categories.map((c) => c.name).concat(['Uncategorised']),
    [categories]
  )

  const addRule = async (merchant: string | null, description: string, cat: string): Promise<void> => {
    const keyword = (merchant ?? description.split(/\s+/).slice(0, 3).join(' ')).trim()
    if (!keyword || !cat) return
    await window.api.addRule(keyword, cat)
    setNotice(`Rule saved: "${keyword}" → ${cat}`)
    setExpanded(null)
    await search()
  }

  const importStatement = async (): Promise<void> => {
    setImporting(true)
    setImportNote('')
    try {
      const r = await window.api.importTransactionsCsv(importAccount || undefined)
      if (r.canceled) return
      setImportNote(
        (r.imported ?? 0) > 0
          ? `Imported ${r.imported} transactions${r.dateFrom ? ` (${r.dateFrom} → ${r.dateTo})` : ''}. ${r.skipped ?? 0} rows skipped.`
          : 'No new transactions — that statement may already be imported.'
      )
      setAccounts(await window.api.listAccounts())
      await search()
    } catch (e) {
      setImportNote(`Import failed: ${(e as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Transactions"
        subtitle="Search every real transaction, check the category it resolves to, and fix the rules."
      />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Import a bank statement</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              CSV export with date, description and amount columns. Re-importing the same file is safe.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-400">
              Account name (optional)
              <input
                value={importAccount}
                onChange={(e) => setImportAccount(e.target.value)}
                placeholder="e.g. Everyday account"
                className={`${fieldCls} mt-1`}
              />
            </label>
            <Button variant="secondary" onClick={importStatement} disabled={importing}>
              {importing ? 'Importing…' : 'Import CSV'}
            </Button>
          </div>
        </div>
        {importNote && (
          <p className={`text-xs ${importNote.startsWith('Import failed') ? 'text-danger' : 'text-accent'}`}>
            {importNote}
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search description or merchant…"
            className={`${fieldCls} sm:col-span-2`}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldCls}>
            <option value="">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={fieldCls}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label className="text-xs text-slate-400">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${fieldCls} mt-1 w-full`} />
          </label>
          <label className="text-xs text-slate-400">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${fieldCls} mt-1 w-full`} />
          </label>
          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('')
                setCategory('')
                setAccountId('')
                setFrom('')
                setTo('')
              }}
            >
              Clear
            </Button>
          </div>
        </div>
        {notice && <p className="text-xs text-accent">{notice}</p>}
      </Card>

      <Card>
        {loading && !result ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        ) : !result || result.rows.length === 0 ? (
          <EmptyState title="No transactions match" hint="Try a shorter search term or clear the filters." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                {result.count} transaction{result.count === 1 ? '' : 's'} (max 300 shown)
                {loading && <Spinner className="ml-2" />}
              </span>
              <span>
                Out <span className="text-slate-200">{money(result.totalDebit)}</span> · In{' '}
                <span className="text-accent">{money(result.totalCredit)}</span>
              </span>
            </div>

            <ul className="divide-y divide-white/[0.08]">
              {result.rows.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{r.description}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {shortDate(r.date)} · {r.accountName}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {r.matchedCategory ? (
                        <span className="hidden max-w-[10rem] truncate text-xs text-slate-400 sm:block">
                          {r.matchedCategory}
                        </span>
                      ) : (
                        <Badge tone="warn">unmapped</Badge>
                      )}
                      <span
                        className={`w-24 text-right text-sm font-medium ${
                          r.amount < 0 ? 'text-slate-200' : 'text-accent'
                        }`}
                      >
                        {money(r.amount)}
                      </span>
                    </div>
                  </button>

                  {expanded === r.id && (
                    <div className="mb-2 rounded-xl border border-white/[0.1] bg-white/[0.04] p-3">
                      <p className="mb-2 text-xs text-slate-400">
                        Merchant: <span className="text-slate-200">{r.merchant ?? '—'}</span> · Bank category:{' '}
                        <span className="text-slate-200">{r.category ?? '—'}</span>
                      </p>
                      <label className="text-xs text-slate-400">
                        Categorise this merchant from now on
                        <div className="mt-1 flex gap-2">
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) void addRule(r.merchant, r.description, e.target.value)
                            }}
                            className={`${fieldCls} flex-1`}
                          >
                            <option value="">Choose a category…</option>
                            {categories.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </label>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
