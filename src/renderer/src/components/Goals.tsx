import { useEffect, useState } from 'react'
import type { Goal } from '@shared/types'
import { Button, Card, EmptyState, ProgressBar, SectionHeader } from './ui'
import { formatDate, money } from '../lib/format'

const fieldCls =
  'mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none'
const labelCls = 'block text-xs font-medium text-slate-400'

/** Days between two YYYY-MM-DD dates (local, no timezone shifts). */
function daysUntil(date: string): number {
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const target = new Date(date + 'T00:00:00')
  return Math.round((target.getTime() - start.getTime()) / 86400000)
}

export default function Goals({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [goals, setGoals] = useState<Goal[]>([])
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [contributions, setContributions] = useState<Record<number, string>>({})
  const [notice, setNotice] = useState('')

  const load = async (): Promise<void> => setGoals(await window.api.listGoals())

  useEffect(() => {
    void load()
  }, [])

  const add = async (): Promise<void> => {
    const t = Number(target)
    if (!name.trim() || !Number.isFinite(t) || t <= 0) {
      setNotice('Give the goal a name and a target greater than zero.')
      return
    }
    await window.api.createGoal(
      name.trim(),
      t,
      Number(saved) || 0,
      targetDate || null
    )
    setName('')
    setTarget('')
    setSaved('')
    setTargetDate('')
    setNotice('Goal added.')
    await load()
    onChanged()
  }

  const contribute = async (goal: Goal): Promise<void> => {
    const raw = contributions[goal.id] ?? ''
    const amount = Number(raw)
    if (!Number.isFinite(amount) || amount === 0) {
      setNotice('Enter an amount to add (negative to withdraw).')
      return
    }
    await window.api.contributeToGoal(goal.id, amount)
    setContributions({ ...contributions, [goal.id]: '' })
    await load()
    onChanged()
  }

  const remove = async (goal: Goal): Promise<void> => {
    if (!confirm(`Delete the goal "${goal.name}"?`)) return
    await window.api.deleteGoal(goal.id)
    await load()
    onChanged()
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Goals"
        subtitle="Savings targets with the weekly amount you need to put aside to hit them on time."
      />

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">New goal</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <label className={`${labelCls} sm:col-span-2`}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="House deposit"
              className={fieldCls}
            />
          </label>
          <label className={labelCls}>
            Target amount
            <input
              type="number"
              min={0}
              step="0.01"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="0.00"
              className={fieldCls}
            />
          </label>
          <label className={labelCls}>
            Target date (optional)
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className={fieldCls}
            />
          </label>
          <label className={labelCls}>
            Already saved
            <input
              type="number"
              min={0}
              step="0.01"
              value={saved}
              onChange={(e) => setSaved(e.target.value)}
              placeholder="0.00"
              className={fieldCls}
            />
          </label>
          <div className="flex items-end">
            <Button onClick={add}>Add goal</Button>
          </div>
        </div>
        {notice && <p className="text-xs text-accent">{notice}</p>}
      </Card>

      {goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          hint="Add a target — a holiday, a new laptop, a deposit — and track progress against it."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {goals.map((g) => {
            const remaining = Math.max(0, g.targetAmount - g.savedAmount)
            const percent = g.targetAmount > 0 ? Math.min(100, (g.savedAmount / g.targetAmount) * 100) : 0
            const days = g.targetDate ? daysUntil(g.targetDate) : null
            const weeksLeft = days !== null && days > 0 ? Math.max(1, Math.round((days / 7) * 10) / 10) : null
            const perWeek = weeksLeft ? remaining / weeksLeft : null

            return (
              <Card key={g.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-100">{g.name}</h3>
                      {remaining === 0 && <span className="text-xs text-accent">Complete 🎉</span>}
                    </div>
                    <p className="text-xs text-slate-500">
                      {money(g.savedAmount)} of {money(g.targetAmount)}
                      {g.targetDate ? ` · by ${formatDate(g.targetDate)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-200">{money(remaining)}</p>
                    <p className="text-[11px] text-slate-500">to go</p>
                  </div>
                </div>

                <ProgressBar percent={percent} tone={remaining === 0 ? 'good' : 'auto'} />

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <span>
                    {percent.toFixed(0)}% saved
                    {perWeek !== null && ` · ${money(perWeek)}/week needed`}
                    {days !== null && days < 0 && ' · target date has passed'}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      value={contributions[g.id] ?? ''}
                      onChange={(e) => setContributions({ ...contributions, [g.id]: e.target.value })}
                      placeholder="Add $"
                      className="w-28 rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
                    />
                    <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => void contribute(g)}>
                      Contribute
                    </Button>
                    <button
                      onClick={() => void remove(g)}
                      className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-danger/15 hover:text-danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
