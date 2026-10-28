import { useEffect, useState } from 'react'
import type { Account } from '@shared/types'
import { Card, EmptyState, SectionHeader } from './ui'

export default function Accounts({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([])

  const load = async (): Promise<void> => {
    setAccounts(await window.api.listAccounts())
  }

  useEffect(() => {
    load()
  }, [])

  const toggle = async (a: Account): Promise<void> => {
    setAccounts(await window.api.setAccountEnabled(a.id, !a.enabled))
    onChanged()
  }

  const included = accounts.filter((a) => a.enabled).length

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Accounts"
        subtitle="Toggle which accounts feed into income, spending and budget calculations. Turn off loan and savings accounts so they don't inflate your totals."
      />

      {accounts.length === 0 ? (
        <EmptyState title="No accounts" hint="Sync your bank to load your accounts." />
      ) : (
        <>
          <p className="text-sm text-slate-400">
            {included} of {accounts.length} accounts included.
          </p>
          <Card>
            <ul className="divide-y divide-surface-800">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{a.name}</p>
                    <p className="text-xs text-slate-500">{a.type ?? 'account'}</p>
                  </div>
                  <button
                    onClick={() => toggle(a)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      a.enabled ? 'bg-accent' : 'bg-surface-600'
                    }`}
                    role="switch"
                    aria-checked={a.enabled}
                    title={a.enabled ? 'Included — click to exclude' : 'Excluded — click to include'}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        a.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
