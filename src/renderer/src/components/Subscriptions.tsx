import { useEffect, useState } from 'react'
import type { Subscription } from '@shared/types'
import { Badge, Button, Card, EmptyState, SectionHeader, Spinner } from './ui'
import { money, shortDate } from '../lib/format'

const cadenceLabel: Record<string, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly'
}

export default function Subscriptions({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [items, setItems] = useState<Subscription[]>([])
  const [monthlyTotal, setMonthlyTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async (): Promise<void> => {
    const r = await window.api.listSubscriptions()
    setItems(r.items)
    setMonthlyTotal(r.monthlyTotal)
  }

  useEffect(() => {
    void load()
  }, [])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setNotice('')
    try {
      const r = await window.api.refreshSubscriptions()
      setItems(r.items)
      setMonthlyTotal(r.monthlyTotal)
      setNotice(r.items.length === 0 ? 'No recurring charges found.' : `Found ${r.items.length} recurring charges.`)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const ignore = async (key: string, merchant: string): Promise<void> => {
    const r = await window.api.ignoreSubscription(key)
    setItems(r.items)
    setMonthlyTotal(r.monthlyTotal)
    setNotice(`"${merchant}" will no longer be reported.`)
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Subscriptions"
        subtitle="Recurring charges detected from your transactions, with monthly equivalents and price rises."
        action={
          <Button variant="secondary" onClick={refresh} disabled={busy}>
            {busy ? <Spinner /> : null}
            Refresh detection
          </Button>
        }
      />

      {notice && <p className="text-xs text-accent">{notice}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Monthly total</p>
          <p className="mt-1 text-2xl font-semibold text-slate-100">{money(monthlyTotal)}</p>
          <p className="mt-0.5 text-xs text-slate-500">≈ {money(monthlyTotal * 12)} a year</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Detected</p>
          <p className="mt-1 text-2xl font-semibold text-slate-100">{items.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">recurring merchants</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Price rises</p>
          <p className="mt-1 text-2xl font-semibold text-warn">{items.filter((i) => i.priceRose).length}</p>
          <p className="mt-0.5 text-xs text-slate-500">since first detection</p>
        </Card>
      </div>

      <Card>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Detected subscriptions</h3>
          <p className="text-xs text-slate-500">
            Budget transfers, envelope funding, grouped budget items and insurance-linked debits are excluded, so your
            own budget plumbing never shows up here.
          </p>
        </div>

        {items.length === 0 ? (
          <EmptyState
            title="Nothing detected yet"
            hint="Needs 3+ charges at a regular interval. Run detection after your next bank sync."
          />
        ) : (
          <ul className="divide-y divide-white/[0.08]">
            {items.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm text-slate-200">{s.merchant}</p>
                    {s.priceRose && <Badge tone="warn">price ↑</Badge>}
                    {s.confidence < 0.6 && <Badge tone="neutral">low confidence</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">
                    {money(s.amount)} {cadenceLabel[s.cadence] ?? s.cadence}
                    {s.priceRose && s.previousAmount ? ` (was ${money(s.previousAmount)})` : ''} · last{' '}
                    {shortDate(s.lastDate)} · {s.occurrences} charges
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm text-slate-200">{money(s.monthlyAmount)}</p>
                    <p className="text-[11px] text-slate-500">/ month</p>
                  </div>
                  <button
                    onClick={() => void ignore(s.key, s.merchant)}
                    title="Ignore this merchant"
                    className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
                  >
                    Ignore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
