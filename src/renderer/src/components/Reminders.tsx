import { useEffect, useState } from 'react'
import type { Reminder } from '@shared/types'
import { Button, Card, EmptyState, SectionHeader } from './ui'
import { shortDate } from '../lib/format'

const REPEAT_OPTIONS = [
  { value: 'none', label: 'Once' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' }
]

const repeatLabel = (r: string): string => REPEAT_OPTIONS.find((o) => o.value === r)?.label ?? 'Once'

export default function Reminders({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [message, setMessage] = useState('')
  const [date, setDate] = useState('')
  const [repeat, setRepeat] = useState('none')

  const load = async (): Promise<void> => {
    setReminders(await window.api.listUserReminders())
  }

  useEffect(() => {
    load()
  }, [])

  const add = async (): Promise<void> => {
    if (!message.trim() || !date) return
    setReminders(await window.api.createUserReminder(message.trim(), date, repeat))
    setMessage('')
    setDate('')
    setRepeat('none')
    onChanged()
  }

  const remove = async (id: number): Promise<void> => {
    setReminders(await window.api.deleteUserReminder(id))
    onChanged()
  }

  const inputCls =
    'mt-1 block rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none'

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Reminders"
        subtitle="Get Discord reminders 5 days before, 2 days before and on the day — with optional repeats."
      />

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">New reminder</h3>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-400">
            Reminder
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="e.g. Pay the power bill"
              className="mt-1 w-full resize-none rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400">
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </label>
            <label className="text-xs text-slate-400">
              Repeat
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className="mt-1 block rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
              >
                {REPEAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={add} disabled={!message.trim() || !date}>
              Add reminder
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Your reminders</h3>
        {reminders.length === 0 ? (
          <EmptyState title="No reminders yet" hint="Add one above to get Discord notifications." />
        ) : (
          <ul className="divide-y divide-white/[0.08]">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{r.message}</p>
                  <p className="text-xs text-slate-500">
                    {shortDate(r.targetDate)} · {repeatLabel(r.repeat)}
                  </p>
                </div>
                <button
                  onClick={() => remove(r.id)}
                  title="Delete reminder"
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-danger/15 hover:text-danger"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
