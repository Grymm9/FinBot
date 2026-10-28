import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Deduction, InsuranceBundle, InsurancePolicy } from '@shared/types'
import { INSURANCE_FREQUENCIES } from '@shared/frequency'
import { Badge, Button, Card, EmptyState, SectionHeader } from './ui'
import { formatDate, money } from '../lib/format'

const COVER_TYPES = [
  'Contents',
  'Home',
  'Home & Contents',
  'Motor Vehicle',
  'Life',
  'Health',
  'Income Protection',
  'Travel',
  'Other'
]

export default function Insurance({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<{
    provider: string
    coverType: string
    premium: string
    frequency: string
    renewalDate: string
  }>({
    provider: '',
    coverType: '',
    premium: '',
    frequency: 'monthly',
    renewalDate: ''
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [newProvider, setNewProvider] = useState('')
  const [newCover, setNewCover] = useState('')
  const [newPremium, setNewPremium] = useState('')
  const [newFrequency, setNewFrequency] = useState('monthly')
  const [newDate, setNewDate] = useState('')
  const [newFile, setNewFile] = useState('')
  const [deductions, setDeductions] = useState<Deduction[]>([])
  const [deductionAccount, setDeductionAccount] = useState('')
  const [bundles, setBundles] = useState<InsuranceBundle[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [renamingBundleId, setRenamingBundleId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const load = async (): Promise<void> => {
    const [p, d, b] = await Promise.all([
      window.api.listPolicies(),
      window.api.listDeductions(),
      window.api.listBundles()
    ])
    setPolicies(p)
    setDeductions(d)
    setBundles(b)
  }

  useEffect(() => {
    load()
  }, [])

  const importFiles = useCallback(
    async (paths: string[]): Promise<void> => {
      setBusy(true)
      setMessage('')
      try {
        const res = await window.api.importInsurancePdfs(paths)
        await load()
        onChanged()
        setMessage(`Imported ${res.imported} ${res.imported === 1 ? 'policy' : 'policies'} — metadata extracted.`)
      } catch (e) {
        setMessage(`Import failed: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [onChanged]
  )

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length === 0) return
    const paths = files.map((f) => window.api.getPathForFile(f)).filter((p): p is string => Boolean(p))
    if (paths.length === 0) {
      setMessage('Could not resolve the dropped file paths — use “Browse” instead.')
      return
    }
    await importFiles(paths)
  }

  const browse = async (): Promise<void> => {
    const res = await window.api.importInsurancePdfDialog()
    if (!res.canceled) {
      setMessage(`Imported ${res.imported} ${res.imported === 1 ? 'policy' : 'policies'}.`)
      await load()
      onChanged()
    }
  }

  const linkAll = async (): Promise<void> => {
    setBusy(true)
    try {
      const { linked } = await window.api.linkPolicies()
      setMessage(`Linked ${linked} ${linked === 1 ? 'policy' : 'policies'} to bank transactions.`)
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (p: InsurancePolicy): void => {
    setEditingId(p.id)
    setDraft({
      provider: p.provider ?? '',
      coverType: p.coverType ?? '',
      premium: p.premium != null ? String(p.premium) : '',
      frequency: p.frequency ?? 'monthly',
      renewalDate: p.renewalDate ?? ''
    })
  }

  const saveEdit = async (id: number): Promise<void> => {
    const premium = Number(draft.premium)
    await window.api.updatePolicy(id, {
      provider: draft.provider || undefined,
      coverType: draft.coverType || undefined,
      premium: Number.isFinite(premium) && draft.premium !== '' ? premium : undefined,
      frequency: draft.frequency || undefined,
      renewalDate: draft.renewalDate || undefined
    })
    setEditingId(null)
    await load()
    onChanged()
  }

  const remove = async (id: number): Promise<void> => {
    await window.api.deletePolicy(id)
    await load()
    onChanged()
  }

  const attachForForm = async (): Promise<void> => {
    const res = await window.api.storePdfDialog()
    if (!res.canceled && res.name) setNewFile(res.name)
  }

  const addPolicy = async (): Promise<void> => {
    const provider = newProvider.trim()
    const premium = Number(newPremium)
    if (!provider && !newCover && newPremium === '' && !newDate && !newFile) return
    await window.api.createPolicy({
      provider: provider || null,
      coverType: newCover || null,
      premium: Number.isFinite(premium) && newPremium !== '' ? premium : null,
      frequency: newFrequency || null,
      renewalDate: newDate || null,
      sourceFile: newFile || null
    })
    setShowAddForm(false)
    setNewProvider('')
    setNewCover('')
    setNewPremium('')
    setNewFrequency('monthly')
    setNewDate('')
    setNewFile('')
    await load()
    onChanged()
  }

  const attachToExisting = async (id: number): Promise<void> => {
    const res = await window.api.attachPdfDialog(id)
    if (!res.canceled) {
      await load()
      onChanged()
    }
  }

  const openPdf = async (id: number): Promise<void> => {
    const r = await window.api.openPolicyFile(id)
    if (!r.ok) setMessage(`❌ ${r.error}`)
  }

  const linkPolicy = async (policyId: number, transactionId: string): Promise<void> => {
    await window.api.linkPolicyToTransaction(policyId, transactionId)
    await load()
    onChanged()
  }

  const unlink = async (policyId: number): Promise<void> => {
    await window.api.unlinkPolicy(policyId)
    await load()
    onChanged()
  }

  const toggleSelect = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const bundleSelected = async (): Promise<void> => {
    if (selected.size === 0) return
    const ids = [...selected]
    const providers = new Set(
      policies
        .filter((p) => ids.includes(p.id))
        .map((p) => p.provider)
        .filter((x): x is string => Boolean(x))
    )
    const name = providers.size === 1 ? [...providers][0] : null
    setBundles(await window.api.createBundle(name, ids))
    setSelected(new Set())
    await load()
    onChanged()
  }

  const startRenameBundle = (b: InsuranceBundle): void => {
    setRenamingBundleId(b.id)
    setRenameDraft(b.name ?? '')
  }

  const saveRenameBundle = async (bundleId: number): Promise<void> => {
    setBundles(await window.api.renameBundle(bundleId, renameDraft))
    setRenamingBundleId(null)
    await load()
    onChanged()
  }

  const linkBundleDeduction = async (bundleId: number, transactionId: string): Promise<void> => {
    setBundles(await window.api.linkBundleToTransaction(bundleId, transactionId))
    await load()
    onChanged()
  }

  const unlinkBundleDeduction = async (bundleId: number): Promise<void> => {
    setBundles(await window.api.unlinkBundle(bundleId))
    await load()
    onChanged()
  }

  const attachBundlePdf = async (bundleId: number): Promise<void> => {
    const res = await window.api.attachBundlePdfDialog(bundleId)
    if (!res.canceled) {
      await load()
      onChanged()
    }
  }

  const openBundlePdf = async (bundleId: number): Promise<void> => {
    const r = await window.api.openBundleFile(bundleId)
    if (!r.ok) setMessage(`❌ ${r.error}`)
  }

  const addBundlePolicy = async (bundleId: number, policyId: number): Promise<void> => {
    setBundles(await window.api.addBundleItem(bundleId, policyId))
    await load()
    onChanged()
  }

  const removeBundlePolicy = async (bundleId: number, policyId: number): Promise<void> => {
    setBundles(await window.api.removeBundleItem(bundleId, policyId))
    await load()
    onChanged()
  }

  const removeBundle = async (bundleId: number): Promise<void> => {
    setBundles(await window.api.deleteBundle(bundleId))
    await load()
    onChanged()
  }

  const accounts = [...new Set(deductions.map((d) => d.account))].sort()

  // Deductions grouped by account, honouring the active account filter. Used to
  // render the "Match deduction" dropdown with account section headers.
  const groupedDeductions = useMemo(() => {
    const filtered = deductions.filter((d) => !deductionAccount || d.account === deductionAccount)
    const map = new Map<string, Deduction[]>()
    for (const d of filtered) {
      const key = d.account || 'Unknown account'
      const arr = map.get(key)
      if (arr) arr.push(d)
      else map.set(key, [d])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [deductions, deductionAccount])

  const bundledPolicyIds = new Set<number>()
  for (const b of bundles) for (const it of b.items) bundledPolicyIds.add(it.policyId)
  const standalonePolicies = policies.filter((p) => !bundledPolicyIds.has(p.id))

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Insurance & policy auditor"
        subtitle="Drop policy PDFs to extract provider, cover, premium and renewal date — then link them to real bank debits."
        action={
          <div className="flex flex-wrap gap-2">
            {selected.size > 0 && (
              <Button onClick={bundleSelected} disabled={busy}>
                Bundle {selected.size} {selected.size === 1 ? 'policy' : 'policies'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? 'Cancel' : 'Add policy'}
            </Button>
            <Button variant="secondary" onClick={linkAll} disabled={busy}>
              Link to transactions
            </Button>
            <Button onClick={browse} disabled={busy}>
              Browse PDF
            </Button>
          </div>
        }
      />

      {message && <p className="text-sm text-accent">{message}</p>}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 text-center transition-colors ${
          dragging ? 'border-accent/60 bg-accent/[0.08]' : 'border-white/[0.16] bg-white/[0.04] backdrop-blur-[20px] backdrop-saturate-[1.8]'
        }`}
      >
        <svg viewBox="0 0 24 24" className="mb-3 h-8 w-8 fill-slate-500" aria-hidden>
          <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
        </svg>
        <p className="text-sm font-medium text-slate-200">
          {busy ? 'Processing…' : 'Drag & drop one or more insurance PDFs here'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          or use “Browse PDF” (multi-select). Premiums, renewal dates and providers are auto-extracted.
        </p>
      </div>

      {showAddForm && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400">
              Provider
              <input
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                placeholder="e.g. AA Insurance"
                className="mt-1 block w-44 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Cover type
              <select
                value={newCover}
                onChange={(e) => setNewCover(e.target.value)}
                className="mt-1 block w-44 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
              >
                <option value="">—</option>
                {COVER_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Price (NZD)
              <input
                type="number"
                min={0}
                step="0.01"
                value={newPremium}
                onChange={(e) => setNewPremium(e.target.value)}
                placeholder="0.00"
                className="mt-1 block w-32 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Frequency
              <select
                value={newFrequency}
                onChange={(e) => setNewFrequency(e.target.value)}
                className="mt-1 block w-32 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
              >
                {INSURANCE_FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Deduction date
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              PDF
              <button
                type="button"
                onClick={attachForForm}
                className="mt-1 block w-40 truncate rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-left text-sm text-slate-100 hover:border-accent focus:outline-none"
              >
                {newFile ? newFile.replace(/^\d+-/, '') : 'Attach PDF…'}
              </button>
            </label>
            <Button onClick={addPolicy} disabled={!newProvider.trim() && !newCover && newPremium === '' && !newDate && !newFile}>
              Save
            </Button>
          </div>
        </Card>
      )}

      {policies.length > 0 && accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-white/[0.16] bg-white/[0.05] px-3 py-2 backdrop-blur-[20px] backdrop-saturate-[1.8]">
          <span className="text-xs font-medium text-slate-300">Match deductions from account:</span>
          <select
            value={deductionAccount}
            onChange={(e) => setDeductionAccount(e.target.value)}
            className="rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-200 focus:border-accent focus:outline-none"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            {deductionAccount ? `showing ${groupedDeductions.reduce((n, [, items]) => n + items.length, 0)} debit(s)` : 'grouped by account below'}
          </span>
        </div>
      )}

      {policies.length === 0 && bundles.length === 0 ? (
        <EmptyState title="No policies added yet" hint="Drop a renewal or policy document to get started." />
      ) : (
        <div className="space-y-4">
          {standalonePolicies.length > 0 && (
            <Card>
              <ul className="divide-y divide-surface-800">
                {standalonePolicies.map((p) => (
                  <li key={p.id} className="py-3">
                {editingId === p.id ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-slate-400">
                      Provider
                      <input
                        value={draft.provider}
                        onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
                        className="mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Cover type
                      <select
                        value={draft.coverType}
                        onChange={(e) => setDraft({ ...draft, coverType: e.target.value })}
                        className="mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                      >
                        <option value="">—</option>
                        {COVER_TYPES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-400">
                      Premium (NZD)
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.premium}
                        onChange={(e) => setDraft({ ...draft, premium: e.target.value })}
                        className="mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Frequency
                      <select
                        value={draft.frequency}
                        onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}
                        className="mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                      >
                        {INSURANCE_FREQUENCIES.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-400">
                      Renewal date
                      <input
                        type="date"
                        value={draft.renewalDate}
                        onChange={(e) => setDraft({ ...draft, renewalDate: e.target.value })}
                        className="mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                      />
                    </label>
                    <div className="col-span-2 flex gap-2 pt-1">
                      <Button onClick={() => saveEdit(p.id)}>Save</Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-accent"
                        title="Select to bundle"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-100">{p.provider ?? 'Unknown provider'}</p>
                        {p.coverType && <Badge tone="neutral">{p.coverType}</Badge>}
                        {p.frequency && (
                          <Badge tone="neutral">
                            {INSURANCE_FREQUENCIES.find((f) => f.value === p.frequency)?.label ?? p.frequency}
                          </Badge>
                        )}
                        {p.linkedTransactionId ? (
                          <Badge tone="good">linked</Badge>
                        ) : (
                          <Badge tone="warn">unlinked</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {(p.sourceFile ?? '').replace(/^\d+-/, '') || 'no file'} · renews {formatDate(p.renewalDate)}
                        {!p.extracted && ' · manual entry'}
                      </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="text-sm font-medium tabular-nums text-slate-100">{money(p.premium)}</p>
                      {p.linkedTransactionId ? (
                        <button
                          onClick={() => unlink(p.id)}
                          className="text-xs text-slate-500 hover:text-danger"
                          title="Unlink deduction"
                        >
                          Unlink
                        </button>
                      ) : (
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) linkPolicy(p.id, e.target.value)
                          }}
                          className="rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-xs text-slate-300 focus:border-accent focus:outline-none"
                          title="Manually match to a bank deduction"
                        >
                          <option value="">Match deduction…</option>
                          {groupedDeductions.map(([account, items]) => (
                            <optgroup key={account} label={account}>
                              {items.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.date.slice(0, 10)} · ${Math.abs(d.amount).toFixed(2)} · {d.description.slice(0, 32)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      )}
                      {p.sourceFile && (
                        <Button variant="ghost" onClick={() => openPdf(p.id)}>
                          Open PDF
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => attachToExisting(p.id)}>
                        Attach
                      </Button>
                      <Button variant="ghost" onClick={() => startEdit(p)}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => remove(p.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
          )}

          {bundles.map((b) => (
            <div key={b.id} className="rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-accent">Bundle</span>
                  {renamingBundleId === b.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => saveRenameBundle(b.id)}
                      onKeyDown={(e) => e.key === 'Enter' && saveRenameBundle(b.id)}
                      className="rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-sm text-slate-100 focus:border-accent focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => startRenameBundle(b)}
                      className="text-sm font-medium text-slate-100 hover:text-accent"
                      title="Rename bundle"
                    >
                      {b.name ?? 'Untitled bundle'} ✎
                    </button>
                  )}
                  <span className="text-xs tabular-nums text-slate-400">{money(b.monthlyTotal)}/mo</span>
                  {b.linkedTransactionId ? (
                    <Badge tone="good">linked</Badge>
                  ) : (
                    <Badge tone="warn">unlinked</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {b.linkedTransactionId ? (
                    <button
                      onClick={() => unlinkBundleDeduction(b.id)}
                      className="text-xs text-slate-500 hover:text-danger"
                      title="Unlink deduction"
                    >
                      Unlink
                    </button>
                  ) : (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) linkBundleDeduction(b.id, e.target.value)
                      }}
                      className="rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-xs text-slate-300 focus:border-accent focus:outline-none"
                      title="Manually match to a bank deduction"
                    >
                      <option value="">Match deduction…</option>
                      {groupedDeductions.map(([account, items]) => (
                        <optgroup key={account} label={account}>
                          {items.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.date.slice(0, 10)} · ${Math.abs(d.amount).toFixed(2)} · {d.description.slice(0, 32)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => removeBundle(b.id)}
                    className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-danger"
                  >
                    Delete bundle
                  </button>
                  {b.sourceFile ? (
                    <>
                      <Button variant="ghost" onClick={() => openBundlePdf(b.id)}>
                        Open PDF
                      </Button>
                      <Button variant="ghost" onClick={() => attachBundlePdf(b.id)}>
                        Replace
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => attachBundlePdf(b.id)}>
                      Attach PDF
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {b.items.map((it) => (
                  <div
                    key={it.policyId}
                    className="flex items-center justify-between rounded-md border border-white/[0.1] bg-white/[0.05] px-2 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm text-slate-200">{it.provider ?? 'Unknown provider'}</span>
                      {it.coverType && <Badge tone="neutral">{it.coverType}</Badge>}
                      {it.frequency && it.frequency !== 'monthly' && (
                        <span className="text-[10px] text-slate-500">
                          {INSURANCE_FREQUENCIES.find((f) => f.value === it.frequency)?.label}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-slate-500">
                        {money(it.premium)} → {money(it.monthly)}/mo
                      </span>
                      {it.sourceFile && (
                        <button
                          onClick={() => openPdf(it.policyId)}
                          title="Open this policy's PDF"
                          className="text-xs text-accent hover:text-accent/80"
                        >
                          Open PDF
                        </button>
                      )}
                      <button
                        onClick={() => removeBundlePolicy(b.id, it.policyId)}
                        title="Remove from bundle"
                        className="text-slate-600 hover:text-danger"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}

                {standalonePolicies.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addBundlePolicy(b.id, Number(e.target.value))
                    }}
                    className="mt-2 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-xs text-slate-400 focus:border-accent focus:outline-none"
                  >
                    <option value="">+ Add policy to bundle…</option>
                    {standalonePolicies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.provider ?? 'Unknown provider'}
                        {p.coverType ? ` — ${p.coverType}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
