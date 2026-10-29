import { useEffect, useMemo, useState } from 'react'
import type { DashboardSummary, Deduction } from '@shared/types'
import { Card, EmptyState, SectionHeader } from './ui'
import { money, shortDate, timestampDate } from '../lib/format'

export default function Notifications({
  summary,
  onChanged
}: {
  summary: DashboardSummary | null
  onChanged: () => void
}): JSX.Element {
  const [candidates, setCandidates] = useState<Deduction[]>([])
  const missed = summary?.missedPayments ?? []
  const matched = summary?.matchedPayments ?? []
  const duplicates = summary?.duplicateCharges ?? []
  const insights = summary?.insights ?? []
  const aiAlerts = summary?.aiAlerts ?? []
  const aiUnread = aiAlerts.filter((a) => !a.readAt).length

  useEffect(() => {
    if (missed.length > 0) {
      void window.api.listPaymentCandidates().then(setCandidates)
    }
  }, [missed.length])

  const groupedCandidates = useMemo(() => {
    const map = new Map<string, Deduction[]>()
    for (const c of candidates) {
      const key = c.account || 'Unknown account'
      const arr = map.get(key)
      if (arr) arr.push(c)
      else map.set(key, [c])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [candidates])

  const match = async (destinationId: number, transactionId: string, kind: 'group' | 'category'): Promise<void> => {
    await window.api.matchPayment(destinationId, transactionId, kind)
    onChanged()
  }

  const unmatch = async (destinationId: number, kind: 'group' | 'category'): Promise<void> => {
    await window.api.unmatchPayment(destinationId, kind)
    onChanged()
  }

  const dismiss = async (key: string): Promise<void> => {
    await window.api.dismissAlert(key)
    onChanged()
  }

  const reviewAi = async (id: number): Promise<void> => {
    await window.api.markAiAlertRead(id)
    onChanged()
  }

  const dismissAi = async (id: number): Promise<void> => {
    await window.api.dismissAiAlert(id)
    onChanged()
  }

  const total = missed.length + duplicates.length + matched.length + insights.length + aiAlerts.length
  const selectCls =
    'rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-xs text-slate-300 focus:border-accent focus:outline-none'

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Notifications"
        subtitle="AI insights, missed payments, duplicate charges and spending alerts — review or dismiss them here."
      />

      {total === 0 ? (
        <EmptyState title="All clear" hint="No AI insights, missed payments, duplicate charges or spending alerts right now." />
      ) : (
        <>
          {aiAlerts.length > 0 && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-200">AI insights</h3>
                {aiUnread > 0 ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-surface-950 shadow-[0_0_10px_rgba(62,166,255,0.5)]">
                    {aiUnread > 99 ? '99+' : aiUnread} unread
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500">All reviewed</span>
                )}
              </div>
              <ul className="divide-y divide-white/[0.08]">
                {aiAlerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`flex items-center gap-2 text-sm font-medium ${
                          a.severity === 'bad' ? 'text-danger' : a.severity === 'warn' ? 'text-warn' : 'text-slate-200'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            a.severity === 'bad' ? 'bg-danger' : a.severity === 'warn' ? 'bg-warn' : 'bg-accent'
                          }`}
                        />
                        {a.title}
                        {!a.readAt && (
                          <span className="rounded-full bg-white/[0.12] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                            New
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{a.body}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {[a.category, a.merchant].filter(Boolean).join(' · ')}
                        {a.category || a.merchant ? ' · ' : ''}
                        {timestampDate(a.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!a.readAt && (
                        <button
                          onClick={() => void reviewAi(a.id)}
                          className="rounded-md px-2 py-1 text-xs text-accent hover:bg-accent/10"
                        >
                          Mark reviewed
                        </button>
                      )}
                      <button
                        onClick={() => void dismissAi(a.id)}
                        title="Dismiss"
                        className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {insights.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-200">
                Spending alerts
              </h3>
              <ul className="divide-y divide-white/[0.08]">
                {insights.map((i) => (
                  <li key={i.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm ${
                          i.severity === 'bad' ? 'text-danger' : i.severity === 'warn' ? 'text-warn' : 'text-slate-200'
                        }`}
                      >
                        {i.severity === 'bad' ? '🔴' : i.severity === 'warn' ? '🟠' : '🔵'} {i.title}
                      </p>
                      <p className="text-xs text-slate-500">{i.detail}</p>
                    </div>
                    <button
                      onClick={() => void dismiss(i.key)}
                      title="Dismiss"
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {duplicates.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-warn">
                ⚠️ Possible duplicate charge{duplicates.length > 1 ? 's' : ''}
              </h3>
              <ul className="divide-y divide-white/[0.08]">
                {duplicates.map((d) => (
                  <li key={d.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{d.merchant}</p>
                      <p className="text-xs text-slate-500">
                        {money(d.amount)} charged {d.count}× ({shortDate(d.firstDate)}
                        {d.lastDate !== d.firstDate ? ` – ${shortDate(d.lastDate)}` : ''})
                      </p>
                    </div>
                    <button
                      onClick={() => void dismiss(d.key)}
                      title="Dismiss"
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {missed.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-200">
                Missed expected payment{missed.length > 1 ? 's' : ''} this cycle
              </h3>
              <ul className="divide-y divide-white/[0.08]">
                {missed.map((m) => (
                  <li key={m.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{m.label}</p>
                      <p className="text-xs text-slate-500">
                        {money(m.amount)}
                        {m.accountNumber ? ` to ${m.accountNumber}` : ''} was not detected.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) void match(m.destinationId, e.target.value, m.kind)
                        }}
                        className={selectCls}
                        title="Match to a transfer/payment"
                      >
                        <option value="">Match payment…</option>
                        {groupedCandidates.map(([account, items]) => (
                          <optgroup key={account} label={account}>
                            {items.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.date.slice(0, 10)} · ${Math.abs(c.amount).toFixed(2)} · {c.description.slice(0, 32)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <button
                        onClick={() => void dismiss(m.key)}
                        title="Dismiss"
                        className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {matched.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Manually matched</h3>
              <ul className="divide-y divide-white/[0.08]">
                {matched.map((m) => (
                  <li key={`${m.kind}:${m.destinationId}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{m.label}</p>
                      <p className="text-xs text-slate-500">
                        {money(m.amount)}
                        {m.accountNumber ? ` to ${m.accountNumber}` : ''} → {shortDate(m.transactionDate)} · $
                        {Math.abs(m.transactionAmount).toFixed(2)} · {m.transactionDescription.slice(0, 32)}
                      </p>
                    </div>
                    <button
                      onClick={() => void unmatch(m.destinationId, m.kind)}
                      title="Undo match"
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:text-danger"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
