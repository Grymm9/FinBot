import { useCallback, useEffect, useState, type DragEvent } from 'react'
import type { BudgetGroup, Category, CategoryRouting, DashboardSummary } from '@shared/types'
import { monthlyAmount, FREQUENCIES, frequencyLabel } from '@shared/frequency'
import { Button, Card, EmptyState, ProgressBar, SectionHeader } from './ui'
import { money } from '../lib/format'

interface ImportData {
  imported?: number
  skipped?: number
  skippedSample?: string[]
  categories?: Category[]
  ocrText?: string
}

export default function Budgets({
  summary,
  onChanged
}: {
  summary: DashboardSummary | null
  onChanged: () => void
}): JSX.Element {
  const [categories, setCategories] = useState<Category[]>([])
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftFrequency, setDraftFrequency] = useState('monthly')
  const [message, setMessage] = useState('')
  const [skipped, setSkipped] = useState<{ count: number; sample: string[] } | null>(null)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newFrequency, setNewFrequency] = useState('monthly')
  const [groups, setGroups] = useState<BudgetGroup[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [routingOpen, setRoutingOpen] = useState<Set<number>>(new Set())
  const [categoryRouting, setCategoryRouting] = useState<CategoryRouting[]>([])
  const [catRoutingOpen, setCatRoutingOpen] = useState<Set<string>>(new Set())
  const [editingGroupItem, setEditingGroupItem] = useState<string | null>(null)
  const [groupItemDraft, setGroupItemDraft] = useState('')
  const [groupItemFreq, setGroupItemFreq] = useState('monthly')
  const [groupItemActiveFrom, setGroupItemActiveFrom] = useState('')
  const [draftActiveFrom, setDraftActiveFrom] = useState('')
  const [payDay, setPayDay] = useState('15')
  const [payFrequency, setPayFrequency] = useState('monthly')
  const [payWeekend, setPayWeekend] = useState('previous')
  const [payAnchor, setPayAnchor] = useState('')

  const load = async (): Promise<void> => {
    const [cats, grps, cr] = await Promise.all([
      window.api.listCategories(),
      window.api.listGroups(),
      window.api.listCategoryDestinations()
    ])
    setCategories(cats)
    setGroups(grps)
    setCategoryRouting(cr)
  }

  useEffect(() => {
    load()
    void (async () => {
      const m = await window.api.getMaskedSettings()
      setPayDay(m.INCOME_CYCLE_DAY || '15')
      setPayFrequency(m.INCOME_CYCLE_FREQUENCY || 'monthly')
      setPayWeekend(m.INCOME_CYCLE_WEEKEND || 'previous')
      setPayAnchor(m.INCOME_CYCLE_ANCHOR || '')
    })()
  }, [])

  const applyResult = (res: ImportData, source: string): void => {
    setMessage(
      `Imported ${res.imported} budget ${res.imported === 1 ? 'category' : 'categories'} from ${source}.`
    )
    setSkipped(res.skipped && res.skipped > 0 ? { count: res.skipped, sample: res.skippedSample ?? [] } : null)
    setOcrText(res.ocrText ?? null)
    setCategories(res.categories ?? [])
    onChanged()
  }

  const importCsv = async (): Promise<void> => {
    setImporting(true)
    setMessage('')
    setSkipped(null)
    setOcrText(null)
    try {
      const res = await window.api.importBudgetCsv()
      if (!res.canceled) applyResult(res, 'CSV')
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  const importImage = useCallback(
    async (filePath: string): Promise<void> => {
      setImporting(true)
      setMessage('')
      setSkipped(null)
      setOcrText(null)
      try {
        const res = await window.api.importBudgetImage(filePath)
        applyResult(res, 'image')
      } catch (e) {
        setMessage(`Image import failed: ${(e as Error).message}`)
      } finally {
        setImporting(false)
      }
    },
    [onChanged]
  )

  const importImageDialog = async (): Promise<void> => {
    setImporting(true)
    setMessage('')
    setSkipped(null)
    setOcrText(null)
    try {
      const res = await window.api.importBudgetImageDialog()
      if (!res.canceled) applyResult(res, 'image')
    } catch (e) {
      setMessage(`Image import failed: ${(e as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  const onDrop = async (e: DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const path = window.api.getPathForFile(file)
    if (!path) {
      setMessage('Could not resolve the dropped file — use “Import image” instead.')
      return
    }
    await importImage(path)
  }

  const saveEdit = async (name: string): Promise<void> => {
    const amount = Number(draft)
    if (Number.isFinite(amount) && amount >= 0) {
      await window.api.setCategoryBudget(name, amount, draftFrequency)
    }
    setCategories(await window.api.setCategoryActiveFrom(name, draftActiveFrom))
    onChanged()
    setEditing(null)
  }

  const deleteItem = async (name: string): Promise<void> => {
    setCategories(await window.api.deleteCategory(name))
    onChanged()
  }

  const toggleSplit = async (c: Category): Promise<void> => {
    setCategories(await window.api.setCategorySplit(c.name, !c.split))
    onChanged()
  }

  const clearAll = async (): Promise<void> => {
    if (!window.confirm('Delete the entire budget (all categories)? This cannot be undone.')) return
    setCategories(await window.api.clearCategories())
    setMessage('')
    setSkipped(null)
    setOcrText(null)
    onChanged()
  }

  const addItem = async (): Promise<void> => {
    const name = newName.trim()
    const amount = Number(newAmount)
    if (!name || !Number.isFinite(amount) || amount < 0) return
    setCategories(await window.api.setCategoryBudget(name, amount, newFrequency))
    setNewName('')
    setNewAmount('')
    setNewFrequency('monthly')
    setShowAddForm(false)
    onChanged()
  }

  const toggleSelect = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const groupSelected = async (): Promise<void> => {
    if (selected.size === 0) return
    setGroups(await window.api.createGroup([...selected]))
    setSelected(new Set())
    onChanged()
  }

  const addDestination = async (groupId: number): Promise<void> => {
    setGroups(await window.api.addDestination(groupId, {}))
  }

  const updateDestination = async (
    destId: number,
    fields: {
      amount?: number | null
      accountNumber?: string | null
      accountType?: string | null
      transferLabel?: string | null
    }
  ): Promise<void> => {
    setGroups(await window.api.updateDestination(destId, fields))
  }

  const removeDestination = async (destId: number): Promise<void> => {
    setGroups(await window.api.removeDestination(destId))
  }

  const removeGroupItem = async (groupId: number, category: string): Promise<void> => {
    setGroups(await window.api.removeGroupItem(groupId, category))
  }

  const addGroupItem = async (groupId: number, category: string): Promise<void> => {
    setGroups(await window.api.addGroupItem(groupId, category))
    onChanged()
  }

  const deleteGroup = async (id: number): Promise<void> => {
    setGroups(await window.api.deleteGroup(id))
  }

  const toggleRouting = (id: number): void => {
    setRoutingOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const savePayDay = async (v: string): Promise<void> => {
    setPayDay(v)
    await window.api.setSetting('INCOME_CYCLE_DAY', v || '15')
    onChanged()
  }

  const savePayFrequency = async (v: string): Promise<void> => {
    setPayFrequency(v)
    await window.api.setSetting('INCOME_CYCLE_FREQUENCY', v)
    onChanged()
  }

  const savePayAnchor = async (v: string): Promise<void> => {
    setPayAnchor(v)
    await window.api.setSetting('INCOME_CYCLE_ANCHOR', v)
    onChanged()
  }

  const savePayWeekend = async (v: string): Promise<void> => {
    setPayWeekend(v)
    await window.api.setSetting('INCOME_CYCLE_WEEKEND', v)
    onChanged()
  }

  const routingFor = (category: string): CategoryRouting | undefined =>
    categoryRouting.find((r) => r.category === category)

  const addCategoryDestination = async (category: string): Promise<void> => {
    setCategoryRouting(await window.api.addCategoryDestination(category, {}))
  }

  const updateCategoryDestination = async (
    destId: number,
    fields: {
      amount?: number | null
      accountNumber?: string | null
      accountType?: string | null
      transferLabel?: string | null
    }
  ): Promise<void> => {
    setCategoryRouting(await window.api.updateCategoryDestination(destId, fields))
  }

  const removeCategoryDestination = async (destId: number): Promise<void> => {
    setCategoryRouting(await window.api.removeCategoryDestination(destId))
  }

  const toggleCatRouting = (category: string): void => {
    setCatRoutingOpen((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const saveGroupItem = async (category: string): Promise<void> => {
    const amount = Number(groupItemDraft)
    if (Number.isFinite(amount) && amount >= 0) {
      await window.api.setCategoryBudget(category, amount, groupItemFreq)
    }
    setCategories(await window.api.setCategoryActiveFrom(category, groupItemActiveFrom))
    onChanged()
    setEditingGroupItem(null)
  }

  const spendFor = (name: string): number =>
    summary?.categories.find((c) => c.category === name)?.spent ?? 0

  const transferTotal = (g: BudgetGroup): number =>
    g.destinations.reduce((s, d) => s + (d.amount ?? 0), 0)

  const groupByCat = new Map<string, BudgetGroup>()
  for (const g of groups) for (const it of g.items) groupByCat.set(it.category, g)
  const standalone = categories.filter((c) => !groupByCat.has(c.name))

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Budgets"
        subtitle="Import your baseline budget from a CSV or a photo/screenshot, with live spend from your bank."
        action={
          <div className="flex flex-wrap gap-2">
            {selected.size > 0 && (
              <Button onClick={groupSelected} disabled={importing}>
                Group {selected.size} {selected.size === 1 ? 'item' : 'items'}
              </Button>
            )}
            {categories.length > 0 && (
              <Button variant="danger" onClick={clearAll} disabled={importing}>
                Clear all
              </Button>
            )}
            <Button variant="secondary" onClick={() => setShowAddForm((v) => !v)} disabled={importing}>
              {showAddForm ? 'Cancel' : 'Add item'}
            </Button>
            <Button variant="secondary" onClick={importImageDialog} disabled={importing}>
              {importing ? 'Scanning…' : 'Import image'}
            </Button>
            <Button onClick={importCsv} disabled={importing}>
              {importing ? 'Working…' : 'Import CSV'}
            </Button>
          </div>
        }
      />

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pay cycle</span>
          <span className="text-xs text-slate-500">{summary ? `current: ${summary.cycleRange}` : ''}</span>
        </div>
        <label className="text-xs text-slate-400">
          Frequency
          <select
            value={payFrequency}
            onChange={(e) => savePayFrequency(e.target.value)}
            className="ml-2 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {payFrequency === 'monthly' ? (
          <>
            <label className="text-xs text-slate-400">
              Pay day
              <input
                type="number"
                min={1}
                max={31}
                value={payDay}
                onChange={(e) => savePayDay(e.target.value)}
                className="ml-2 w-20 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Weekend
              <select
                value={payWeekend}
                onChange={(e) => savePayWeekend(e.target.value)}
                className="ml-2 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
              >
                <option value="previous">Shift to Friday</option>
                <option value="next">Shift to Monday</option>
                <option value="none">Keep day</option>
              </select>
            </label>
          </>
        ) : (
          <label className="text-xs text-slate-400">
            Payday (anchor date)
            <input
              type="date"
              value={payAnchor}
              onChange={(e) => savePayAnchor(e.target.value)}
              className="ml-2 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
            />
          </label>
        )}
      </Card>

      {showAddForm && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400">
              Category name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Meal Kit"
                className="mt-1 block w-52 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Amount (NZD)
              <input
                type="number"
                min={0}
                step="0.01"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1 block w-36 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Frequency
              <select
                value={newFrequency}
                onChange={(e) => setNewFrequency(e.target.value)}
                className="mt-1 block w-32 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={addItem} disabled={!newName.trim() || newAmount === ''}>
              Add
            </Button>
          </div>
        </Card>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-6 text-center transition-colors ${
          dragging ? 'border-accent/60 bg-accent/[0.08]' : 'border-white/[0.16] bg-white/[0.04] backdrop-blur-[20px] backdrop-saturate-[1.8]'
        }`}
      >
        <p className="text-sm font-medium text-slate-200">Drag & drop a budget image here</p>
        <p className="mt-1 text-xs text-slate-500">
          PNG / JPG screenshot of your budget table — OCR will read the categories and amounts.
        </p>
      </div>

      {message && <p className="text-sm text-accent">{message}</p>}

      {skipped && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          <p className="font-medium">
            {skipped.count} row{skipped.count === 1 ? '' : 's'} skipped (unparseable amount, empty name, or a total row).
          </p>
          {skipped.sample.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-slate-300">
              {skipped.sample.map((s, i) => (
                <li key={i} className="truncate">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ocrText && (
        <details className="rounded-[14px] border border-white/[0.16] bg-white/[0.05] p-3 text-xs text-slate-400 backdrop-blur-[20px] backdrop-saturate-[1.8]">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-300">
            View OCR text (what the scanner read)
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{ocrText}</pre>
        </details>
      )}

      {categories.length === 0 && groups.length === 0 ? (
        <EmptyState
          title="No budget yet"
          hint="Import a CSV or drop a screenshot of your budget. Columns: category, monthly budget (e.g. “Groceries, 800”)."
        />
      ) : (
        <Card>
          <div className="space-y-3">
            {standalone.map((c) => {
              const spent = spendFor(c.name)
              const budget = monthlyAmount(c.amount, c.frequency)
              const percent = budget > 0 ? (spent / budget) * 100 : 0
              const dests = routingFor(c.name)?.destinations ?? []
              return (
                <div key={c.name} className="space-y-1">
                  <div className="flex items-center gap-4">
                    <input
                      type="checkbox"
                      checked={selected.has(c.name)}
                      onChange={() => toggleSelect(c.name)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-accent"
                    />
                    <div className="flex w-48 shrink-0 items-center gap-1.5">
                      <span className="truncate text-sm text-slate-200">{c.name}</span>
                      <button
                        onClick={() => toggleSplit(c)}
                        title={c.split ? 'Split 50/50 — reimbursements are netted off' : 'Mark as split 50/50'}
                        className={`shrink-0 rounded px-1 text-[10px] font-bold ${
                          c.split ? 'bg-accent/20 text-accent' : 'text-slate-600 hover:text-slate-300'
                        }`}
                      >
                        ½
                      </button>
                      {c.frequency !== 'monthly' && (
                        <span
                          className="shrink-0 rounded bg-white/[0.08] px-1 text-[10px] text-slate-400"
                          title={`${money(c.amount)} per ${frequencyLabel(c.frequency)}`}
                        >
                          {frequencyLabel(c.frequency)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <ProgressBar percent={percent} />
                    </div>
                    <div className="w-40 shrink-0 text-right text-sm tabular-nums text-slate-400">
                      {money(spent)} <span className="text-slate-600">/</span> {money(budget)}
                    </div>
                    <div className="w-56 shrink-0">
                      {editing === c.name ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="number"
                            min={0}
                            step="0.01"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => saveEdit(c.name)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit(c.name)}
                            className="w-20 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-sm text-slate-100 focus:border-accent focus:outline-none"
                          />
                          <select
                            value={draftFrequency}
                            onChange={(e) => setDraftFrequency(e.target.value)}
                            className="rounded-md border border-white/[0.16] bg-white/[0.06] px-1 py-1 text-xs text-slate-100 focus:border-accent focus:outline-none"
                          >
                            {FREQUENCIES.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="date"
                            value={draftActiveFrom}
                            onChange={(e) => setDraftActiveFrom(e.target.value)}
                            title="Active from (spend before this date is ignored)"
                            className="rounded-md border border-white/[0.16] bg-white/[0.06] px-1 py-1 text-xs text-slate-100 focus:border-accent focus:outline-none"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditing(c.name)
                            setDraft(String(c.amount))
                            setDraftFrequency(c.frequency)
                            setDraftActiveFrom(c.activeFrom ?? '')
                          }}
                          className="w-full rounded-md px-2 py-1 text-right text-xs text-slate-500 hover:bg-white/[0.08] hover:text-slate-300"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => toggleCatRouting(c.name)}
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.08]"
                      title="Add routing to this item"
                    >
                      Route{dests.length > 0 ? ` (${dests.length})` : ''} {catRoutingOpen.has(c.name) ? '▴' : '▾'}
                    </button>
                    <button
                      onClick={() => deleteItem(c.name)}
                      title="Delete category"
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-danger/15 hover:text-danger"
                    >
                      Delete
                    </button>
                  </div>

                  {catRoutingOpen.has(c.name) && (
                    <div className="rounded-[14px] border border-white/[0.12] bg-white/[0.06] p-3 backdrop-blur-[20px] backdrop-saturate-[1.8]">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Destination routing</p>
                        <button
                          onClick={() => addCategoryDestination(c.name)}
                          className="rounded-md px-2 py-1 text-xs text-accent hover:bg-white/[0.08]"
                        >
                          + Add destination
                        </button>
                      </div>
                      {dests.length === 0 ? (
                        <p className="text-xs text-slate-500">No destinations yet — add one to route this item's transfer.</p>
                      ) : (
                        <div className="space-y-2">
                          {dests.map((d) => (
                            <div key={d.id} className="flex flex-wrap items-end gap-2 rounded-md border border-white/[0.1] bg-white/[0.05] p-2">
                              <label className="text-xs text-slate-400">
                                Amount
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  defaultValue={d.amount ?? budget}
                                  onBlur={(e) =>
                                    updateCategoryDestination(d.id, { amount: e.target.value === '' ? null : Number(e.target.value) })
                                  }
                                  className="mt-1 block w-24 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                                />
                              </label>
                              <label className="text-xs text-slate-400">
                                Account number
                                <input
                                  defaultValue={d.accountNumber ?? ''}
                                  onBlur={(e) => updateCategoryDestination(d.id, { accountNumber: e.target.value.trim() || null })}
                                  placeholder="e.g. 123147042361801"
                                  className="mt-1 block w-40 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
                                />
                              </label>
                              <label className="text-xs text-slate-400">
                                Account type
                                <select
                                  value={d.accountType ?? ''}
                                  onChange={(e) => updateCategoryDestination(d.id, { accountType: e.target.value || null })}
                                  className="mt-1 block w-44 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                                >
                                  <option value="">External / expense</option>
                                  <option value="buffer">Internal buffer / sinking fund</option>
                                </select>
                              </label>
                              <label className="text-xs text-slate-400">
                                Transfer label
                                <input
                                  defaultValue={d.transferLabel ?? ''}
                                  onBlur={(e) => updateCategoryDestination(d.id, { transferLabel: e.target.value.trim() || null })}
                                  placeholder="e.g. Groceries"
                                  className="mt-1 block w-40 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
                                />
                              </label>
                              <button
                                onClick={() => removeCategoryDestination(d.id)}
                                title="Remove destination"
                                className="pb-1 text-xs text-slate-500 hover:text-danger"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {groups.map((g) => (
              <div key={g.id} className="rounded-xl border-2 border-accent/30 bg-accent/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-accent">Group</span>
                    <span className="text-xs text-slate-400">
                      Total {money(g.sum)}
                      {g.destinations.length > 0 && transferTotal(g) !== g.sum && (
                        <span className="text-warn"> · routed {money(transferTotal(g))}</span>
                      )}
                    </span>
                    {g.destinations.some((d) => d.accountType === 'buffer') && (
                      <span className="rounded bg-white/[0.08] px-1 text-[10px] text-slate-300">buffer</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRouting(g.id)}
                      className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.08]"
                    >
                      Routing {routingOpen.has(g.id) ? '▴' : '▾'}
                    </button>
                    <button
                      onClick={() => deleteGroup(g.id)}
                      className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-danger"
                    >
                      Delete group
                    </button>
                  </div>
                </div>

                <div className="mt-2 space-y-1">
                  {g.items.map((it) => {
                    const cat = categories.find((c) => c.name === it.category)
                    return (
                      <div
                        key={it.category}
                        className="flex items-center justify-between rounded-md border border-white/[0.1] bg-white/[0.05] px-2 py-1.5"
                      >
                        <span className="text-sm text-slate-200">{it.category}</span>
                        <div className="flex items-center gap-2">
                          {editingGroupItem === it.category ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                type="number"
                                min={0}
                                step="0.01"
                                value={groupItemDraft}
                                onChange={(e) => setGroupItemDraft(e.target.value)}
                                onBlur={() => saveGroupItem(it.category)}
                                onKeyDown={(e) => e.key === 'Enter' && saveGroupItem(it.category)}
                                className="w-20 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-sm text-slate-100 focus:border-accent focus:outline-none"
                              />
                              <select
                                value={groupItemFreq}
                                onChange={(e) => setGroupItemFreq(e.target.value)}
                                className="rounded-md border border-white/[0.16] bg-white/[0.06] px-1 py-1 text-xs text-slate-100 focus:border-accent focus:outline-none"
                              >
                                {FREQUENCIES.map((f) => (
                                  <option key={f.value} value={f.value}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="date"
                                value={groupItemActiveFrom}
                                onChange={(e) => setGroupItemActiveFrom(e.target.value)}
                                title="Active from (spend before this date is ignored)"
                                className="rounded-md border border-white/[0.16] bg-white/[0.06] px-1 py-1 text-xs text-slate-100 focus:border-accent focus:outline-none"
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingGroupItem(it.category)
                                setGroupItemDraft(String(cat?.amount ?? it.amount))
                                setGroupItemFreq(cat?.frequency ?? 'monthly')
                                setGroupItemActiveFrom(cat?.activeFrom ?? '')
                              }}
                              title="Edit cost"
                              className="text-xs tabular-nums text-slate-500 hover:text-slate-300"
                            >
                              {money(it.amount)}/mo ✎
                            </button>
                          )}
                          <button
                            onClick={() => removeGroupItem(g.id, it.category)}
                            title="Remove from group"
                            className="text-slate-600 hover:text-danger"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addGroupItem(g.id, e.target.value)
                    }}
                    className="mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-xs text-slate-400 focus:border-accent focus:outline-none"
                  >
                    <option value="">+ Add item to group…</option>
                    {standalone.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {routingOpen.has(g.id) && (
                  <div className="mt-3 rounded-[14px] border border-white/[0.12] bg-white/[0.06] p-3 backdrop-blur-[20px] backdrop-saturate-[1.8]">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Destination routing
                      </p>
                      <button
                        onClick={() => addDestination(g.id)}
                        className="rounded-md px-2 py-1 text-xs text-accent hover:bg-white/[0.08]"
                      >
                        + Split destination
                      </button>
                    </div>
                    {g.destinations.length === 0 && (
                      <p className="text-xs text-slate-500">
                        No destinations yet — add one to route this group's transfer.
                      </p>
                    )}
                    <div className="space-y-2">
                      {g.destinations.map((d) => (
                        <div key={d.id} className="flex flex-wrap items-end gap-2 rounded-md border border-white/[0.1] bg-white/[0.05] p-2">
                          <label className="text-xs text-slate-400">
                            Amount
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              defaultValue={d.amount ?? g.sum}
                              onBlur={(e) =>
                                updateDestination(d.id, { amount: e.target.value === '' ? null : Number(e.target.value) })
                              }
                              className="mt-1 block w-24 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                            />
                          </label>
                          <label className="text-xs text-slate-400">
                            Account number
                            <input
                              defaultValue={d.accountNumber ?? ''}
                              onBlur={(e) => updateDestination(d.id, { accountNumber: e.target.value.trim() || null })}
                              placeholder="e.g. 123147042361801"
                              className="mt-1 block w-40 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
                            />
                          </label>
                          <label className="text-xs text-slate-400">
                            Account type
                            <select
                              value={d.accountType ?? ''}
                              onChange={(e) => updateDestination(d.id, { accountType: e.target.value || null })}
                              className="mt-1 block w-44 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
                            >
                              <option value="">External / expense</option>
                              <option value="buffer">Internal buffer / sinking fund</option>
                            </select>
                          </label>
                          <label className="text-xs text-slate-400">
                            Transfer label
                            <input
                              defaultValue={d.transferLabel ?? ''}
                              onBlur={(e) => updateDestination(d.id, { transferLabel: e.target.value.trim() || null })}
                              placeholder="e.g. Bundle Insurance"
                              className="mt-1 block w-40 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
                            />
                          </label>
                          <button
                            onClick={() => removeDestination(d.id)}
                            title="Remove destination"
                            className="pb-1 text-xs text-slate-500 hover:text-danger"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    {g.destinations.length > 0 && transferTotal(g) !== g.sum && (
                      <p className="mt-2 text-xs text-warn">
                        Split total {money(transferTotal(g))} ≠ group total {money(g.sum)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
