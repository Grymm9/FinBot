import { useEffect, useState } from 'react'
import type { BalanceInfo, ManualAsset } from '@shared/types'
import { Card } from './ui'
import { money } from '../lib/format'

export default function BalancesWidget({
  balances,
  manualAssets,
  onChanged,
  className = ''
}: {
  balances: BalanceInfo[]
  manualAssets: ManualAsset[]
  onChanged: () => void
  className?: string
}): JSX.Element {
  const [assets, setAssets] = useState<ManualAsset[]>(manualAssets)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    setAssets(manualAssets)
  }, [manualAssets])

  const add = async (): Promise<void> => {
    const n = name.trim()
    const a = Number(amount)
    if (!n || !Number.isFinite(a)) return
    setAssets(await window.api.addManualAsset(n, a))
    setName('')
    setAmount('')
    onChanged()
  }

  const remove = async (id: number): Promise<void> => {
    setAssets(await window.api.removeManualAsset(id))
    onChanged()
  }

  const updateAmount = async (id: number, v: string): Promise<void> => {
    const a = Number(v)
    if (Number.isFinite(a)) {
      setAssets(await window.api.updateManualAsset(id, { amount: a }))
      onChanged()
    }
  }

  const syncedTotal = balances.filter((b) => b.enabled).reduce((s, b) => s + b.current, 0)
  const manualTotal = assets.reduce((s, a) => s + a.amount, 0)
  const total = syncedTotal + manualTotal

  return (
    <Card className={className}>
      <h3 className="mb-3 text-sm font-semibold text-slate-200">Balances & savings</h3>

      <ul className="space-y-1.5">
        {balances.map((b) => (
          <li key={b.account} className="flex items-center justify-between text-sm">
            <span className={b.enabled ? 'text-slate-200' : 'text-slate-500 line-through'}>{b.account}</span>
            <span className="tabular-nums text-slate-300">{money(b.current)}</span>
          </li>
        ))}
      </ul>

      <div className="my-3 border-t border-surface-800" />

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Manual savings / assets
      </p>
      {assets.map((a) => (
        <div key={a.id} className="mb-1.5 flex items-center justify-between text-sm">
          <span className="truncate text-slate-200">{a.name}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              type="number"
              step="0.01"
              defaultValue={a.amount}
              onBlur={(e) => updateAmount(a.id, e.target.value)}
              className="w-24 rounded-md border border-surface-600 bg-surface-800 px-2 py-0.5 text-right text-sm text-slate-100 focus:border-accent focus:outline-none"
            />
            <button onClick={() => remove(a.id)} title="Remove" className="text-slate-500 hover:text-danger">
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Sharesies)"
          className="min-w-[120px] flex-1 rounded-md border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-accent focus:outline-none"
        />
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="0.00"
          className="w-24 rounded-md border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!name.trim() || amount === ''}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-950 transition-colors hover:bg-accent/90 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-surface-800 pt-3">
        <span className="text-sm text-slate-400">Total net liquidity</span>
        <span className="text-lg font-semibold text-accent">{money(total)}</span>
      </div>
    </Card>
  )
}
