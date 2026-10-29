import { useState } from 'react'
import type { AiAlert } from '@shared/types'
import { Card } from './ui'
import { timestampDate } from '../lib/format'

const TONES: Record<AiAlert['severity'], string> = {
  bad: 'border-danger/30 bg-danger/[0.07]',
  warn: 'border-warn/25 bg-warn/[0.06]',
  info: 'border-accent/25 bg-accent/[0.06]'
}

const DOTS: Record<AiAlert['severity'], string> = {
  bad: 'bg-danger',
  warn: 'bg-warn',
  info: 'bg-accent'
}

export default function AiInsightsPanel({
  alerts,
  unread,
  onChanged,
  onViewAll
}: {
  alerts: AiAlert[]
  unread: number
  onChanged: () => void
  onViewAll: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<number | null>(null)
  const visible = alerts.slice(0, 3)

  const review = async (id: number): Promise<void> => {
    setBusy(id)
    try {
      await window.api.markAiAlertRead(id)
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accent shadow-[0_0_18px_rgba(62,166,255,0.22)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
              <path d="M12 2.5l1.63 4.47L18 8.6l-4.37 1.63L12 14.7l-1.63-4.47L6 8.6l4.37-1.63L12 2.5zm6.5 9.5l.9 2.46 2.46.9-2.46.9-.9 2.46-.9-2.46-2.46-.9 2.46-.9.9-2.46zM5.2 14.4l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
            </svg>
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100">Notifications</h3>
              {unread > 0 ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-surface-950 shadow-[0_0_10px_rgba(62,166,255,0.5)]">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : (
                <span className="text-[11px] text-slate-500">All reviewed</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Automatic checks for recurring price rises and spending running ahead of your normal pace.
            </p>
          </div>
        </div>
        <button
          onClick={onViewAll}
          className="rounded-full border border-white/[0.14] bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-slate-100"
        >
          View all
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-dashed border-white/[0.14] bg-white/[0.03] px-4 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
            </svg>
          </span>
          <p className="text-sm text-slate-400">
            No AI alerts right now. New price rises and spending acceleration will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((alert) => (
            <div key={alert.id} className={`rounded-2xl border px-4 py-3 ${TONES[alert.severity]}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${DOTS[alert.severity]}`} />
                    <p className="text-sm font-medium text-slate-100">{alert.title}</p>
                    {!alert.readAt && (
                      <span className="rounded-full bg-white/[0.12] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300">{alert.body}</p>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {[alert.category, alert.merchant].filter(Boolean).join(' · ')}
                    {alert.category || alert.merchant ? ' · ' : ''}
                    {timestampDate(alert.createdAt)}
                  </p>
                </div>
                {!alert.readAt && (
                  <button
                    onClick={() => void review(alert.id)}
                    disabled={busy === alert.id}
                    className="shrink-0 rounded-full border border-white/[0.14] bg-white/[0.06] px-3 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/[0.12] hover:text-slate-100 disabled:opacity-50"
                  >
                    {busy === alert.id ? 'Saving…' : 'Mark reviewed'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {alerts.length > visible.length && (
            <button
              onClick={onViewAll}
              className="w-full rounded-full py-1.5 text-center text-[11px] text-slate-500 transition-colors hover:text-slate-300"
            >
              +{alerts.length - visible.length} more in Notifications
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
