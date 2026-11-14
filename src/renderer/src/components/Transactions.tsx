import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Account, Category, TransactionRow, TransactionSearchResult } from '@shared/types'
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
  const [splitEdits, setSplitEdits] = useState<Array<{ category: string; amount: string }>>([])
  const [splitBusy, setSplitBusy] = useState(false)
  const [splitNotice, setSplitNotice] = useState('')

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

  const openRow = (r: TransactionRow): void => {
    if (expanded === r.id) {
      setExpanded(null)
      return
    }
    setExpanded(r.id)
    setSplitNotice('')
    setSplitEdits(
      r.splits.length > 0
        ? r.splits.map((s) => ({ category: s.category, amount: s.amount.toFixed(2) }))
        : [{ category: '', amount: '' }]
    )
  }

  const updateSplitLine = (index: number, patch: { category?: string; amount?: string }): void => {
    setSplitEdits((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  const addSplitLine = (): void => setSplitEdits((prev) => [...prev, { category: '', amount: '' }])

  const removeSplitLine = (index: number): void =>
    setSplitEdits((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))

  const applySplitResult = (result: { splits?: Array<{ category: string; amount: number }> }): void => {
    setSplitEdits(
      result.splits && result.splits.length > 0
        ? result.splits.map((s) => ({ category: s.category, amount: s.amount.toFixed(2) }))
        : [{ category: '', amount: '' }]
    )
  }

  const saveSplit = async (r: TransactionRow): Promise<void> => {
    setSplitBusy(true)
    setSplitNotice('')
    try {
      const lines = splitEdits
        .filter((line) => line.category.trim() && line.amount.trim())
        .map((line) => ({ category: line.category, amount: Number(line.amount) }))
      const result = await window.api.splitTransaction({
        transactionId: r.id,
        splits: lines,
        replace: true
      })
      if (!result.ok) {
        setSplitNotice(`❌ ${result.error ?? 'Could not save the split.'}`)
        return
      }
      applySplitResult(result)
      setSplitNotice(`✅ ${result.summary ?? 'Split saved.'}`)
      await search()
    } finally {
      setSplitBusy(false)
    }
  }

  const clearSplit = async (r: TransactionRow): Promise<void> => {
    if (!confirm(`Remove the split on "${r.description}" and treat it as one transaction again?`)) return
    setSplitBusy(true)
    setSplitNotice('')
    try {
      const result = await window.api.splitTransaction({ transactionId: r.id, splits: [], replace: true })
      if (!result.ok) {
        setSplitNotice(`❌ ${result.error ?? 'Could not clear the split.'}`)
        return
      }
      applySplitResult(result)
      setSplitNotice(`✅ ${result.summary ?? 'Split cleared.'}`)
      await search()
    } finally {
      setSplitBusy(false)
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
              {result.rows.map((r) => {
                const splitTotal = splitEdits.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
                const splitReady =
                  splitEdits.length > 0 &&
                  splitEdits.every((line) => line.category.trim() && Number(line.amount) > 0) &&
                  Math.round(splitTotal * 100) === Math.round(Math.abs(r.amount) * 100)

                return (
                  <li key={r.id}>
                    <button
                      onClick={() => openRow(r)}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-200">{r.description}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {shortDate(r.date)} · {r.accountName}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {r.splits.length > 0 ? (
                          <Badge tone="good">split · {r.splits.length}</Badge>
                        ) : r.matchedCategory ? (
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

                    {r.splits.length > 0 && (
                      <div className="mb-2 ml-4 space-y-0.5 border-l border-accent/30 pl-3">
                        {r.splits.map((s) => (
                          <div key={s.category} className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="truncate text-slate-400">{s.category}</span>
                            <span className="shrink-0 text-slate-300">{money(s.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {expanded === r.id && (
                      <div className="mb-2 space-y-3 rounded-xl border border-white/[0.1] bg-white/[0.04] p-3">
                        <p className="text-xs text-slate-400">
                          Merchant: <span className="text-slate-200">{r.merchant ?? '—'}</span> · Bank category:{' '}
                          <span className="text-slate-200">{r.category ?? '—'}</span>
                        </p>

                        {r.amount < 0 && (r.splittable || r.splits.length > 0) && (
                          <div className="space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-slate-300">Split across categories</p>
                              <p className="text-[11px] text-slate-500">
                                Transaction total {money(Math.abs(r.amount))}
                              </p>
                            </div>

                            {r.splittable ? (
                              <>
                                {splitEdits.map((line, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <select
                                      value={line.category}
                                      onChange={(e) => updateSplitLine(i, { category: e.target.value })}
                                      className={`${fieldCls} min-w-0 flex-1`}
                                    >
                                      <option value="">Choose a category…</option>
                                      {categories.map((c) => (
                                        <option key={c.name} value={c.name}>
                                          {c.name}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0.01"
                                      step="0.01"
                                      value={line.amount}
                                      onChange={(e) => updateSplitLine(i, { amount: e.target.value })}
                                      placeholder="0.00"
                                      className={`${fieldCls} w-24 text-right`}
                                    />
                                    <button
                                      onClick={() => removeSplitLine(i)}
                                      disabled={splitEdits.length <= 1}
                                      className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-danger/15 hover:text-danger disabled:opacity-30"
                                      title="Remove this split line"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <button
                                    onClick={addSplitLine}
                                    className="text-[11px] font-medium text-accent hover:underline"
                                  >
                                    + Add category
                                  </button>
                                  <span className={`text-[11px] ${splitReady ? 'text-accent' : 'text-warn'}`}>
                                    Split total {money(splitTotal)} / {money(Math.abs(r.amount))}
                                  </span>
                                </div>
                              </>
                            ) : (
                              <p className="text-[11px] text-slate-500">
                                This account can no longer be edited (loan/asset or excluded account). You can still
                                clear the existing split.
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {r.splittable && (
                                <Button
                                  onClick={() => void saveSplit(r)}
                                  disabled={splitBusy || !splitReady}
                                  className="px-4 py-2 text-xs"
                                >
                                  {splitBusy ? 'Saving…' : r.splits.length > 0 ? 'Update split' : 'Save split'}
                                </Button>
                              )}
                              {r.splits.length > 0 && (
                                <Button
                                  variant="danger"
                                  onClick={() => void clearSplit(r)}
                                  disabled={splitBusy}
                                  className="px-4 py-2 text-xs"
                                >
                                  Clear split
                                </Button>
                              )}
                            </div>

                            {splitNotice && (
                              <p
                                className={`text-xs ${
                                  splitNotice.startsWith('❌') ? 'text-danger' : 'text-accent'
                                }`}
                              >
                                {splitNotice}
                              </p>
                            )}
                          </div>
                        )}

                        {r.amount < 0 && !r.splittable && r.splits.length === 0 && (
                          <p className="text-[11px] text-slate-500">
                            Splitting is not available for this account (loan/asset accounts and excluded accounts
                            cannot be split).
                          </p>
                        )}

                        <label className="block text-xs text-slate-400">
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
                )
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
