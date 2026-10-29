import { useEffect, useState } from 'react'
import type { BankStatus } from '@shared/types'
import type { View } from '../App'
import BrandMark from './BrandMark'
import { Spinner } from './ui'

const BELL_ICON =
  'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z'

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-18v6h8V3h-8z' },
  { id: 'budgets', label: 'Budgets', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H6v-2h6v2zm6-4H6v-2h12v2zm0-4H6V7h12v2z' },
  { id: 'transactions', label: 'Transactions', icon: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z' },
  { id: 'subscriptions', label: 'Subscriptions', icon: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z' },
  { id: 'notifications', label: 'Notifications', icon: BELL_ICON },
  { id: 'deals', label: 'Deals', icon: 'M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.41l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.41zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z' },
  { id: 'goals', label: 'Goals', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 7c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z' },
  { id: 'mapping', label: 'Mapping', icon: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z' },
  { id: 'insurance', label: 'Insurance', icon: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z' },
  { id: 'email', label: 'Email', icon: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z' },
  { id: 'accounts', label: 'Accounts', icon: 'M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z' },
  { id: 'reminders', label: 'Reminders', icon: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z' },
  { id: 'memory', label: 'Memory', icon: 'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z' },
  { id: 'settings', label: 'Settings', icon: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z' }
]

const NAV_ORDER_KEY = 'financebot.nav-order.v1'
const DEFAULT_ORDER: View[] = NAV.map((item) => item.id)

/** Merge a saved order with the current nav list so new pages still appear. */
function readOrder(): View[] {
  try {
    const raw = localStorage.getItem(NAV_ORDER_KEY)
    if (!raw) return DEFAULT_ORDER
    const saved: unknown = JSON.parse(raw)
    if (!Array.isArray(saved)) return DEFAULT_ORDER

    const valid = new Set<View>(DEFAULT_ORDER)
    const seen = new Set<View>()
    const order: View[] = []
    for (const value of saved) {
      if (typeof value !== 'string') continue
      const id = value as View
      if (valid.has(id) && !seen.has(id)) {
        order.push(id)
        seen.add(id)
      }
    }
    for (const id of DEFAULT_ORDER) {
      if (!seen.has(id)) order.push(id)
    }
    return order
  } catch {
    return DEFAULT_ORDER
  }
}

export default function Sidebar({
  view,
  setView,
  bankStatus,
  notificationCount,
  onSync
}: {
  view: View
  setView: (v: View) => void
  bankStatus: BankStatus | null
  notificationCount: number
  onSync: () => void
}): JSX.Element {
  const [syncing, setSyncing] = useState(false)
  const [order, setOrder] = useState<View[]>(readOrder)
  const [dragId, setDragId] = useState<View | null>(null)
  const [overId, setOverId] = useState<View | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order))
    } catch {
      // Storage can be unavailable in hardened renderers; ordering is cosmetic.
    }
  }, [order])

  const move = (from: View, to: View): void => {
    setOrder((prev) => {
      const fromIndex = prev.indexOf(from)
      const toIndex = prev.indexOf(to)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  const sync = async (): Promise<void> => {
    setSyncing(true)
    try {
      await window.api.syncBank()
      onSync()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-white/[0.12] bg-white/[0.04] backdrop-blur-[20px] backdrop-saturate-[1.8]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <BrandMark className="h-9 w-9 drop-shadow-[0_0_14px_rgba(62,166,255,0.45)]" />
        <div>
          <p className="text-sm font-semibold text-slate-100">FinanceBot</p>
          <p className="text-[10px] text-slate-500">Akahu · AI advisor</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-2">
        {order.map((id) => {
          const item = NAV.find((n) => n.id === id)
          if (!item) return null
          const active = view === item.id
          const badge = item.id === 'notifications' ? notificationCount : 0
          return (
            <button
              key={item.id}
              draggable
              onDragStart={(e) => {
                setDragId(item.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', item.id)
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overId !== item.id) setOverId(item.id)
              }}
              onDragLeave={() => {
                if (overId === item.id) setOverId(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== item.id) move(dragId, item.id)
                setDragId(null)
                setOverId(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onClick={() => setView(item.id)}
              title={`${item.label} — drag to reorder`}
              className={`group flex w-full cursor-grab items-center gap-3 rounded-full border px-3 py-2 text-sm transition-colors active:cursor-grabbing ${
                active
                  ? 'border-white/[0.12] bg-white/[0.08] text-slate-100'
                  : 'border-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
              } ${dragId === item.id ? 'opacity-40' : ''} ${
                overId === item.id && dragId !== item.id ? 'border-accent/60 bg-accent/[0.08]' : ''
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden>
                <path d={item.icon} />
              </svg>
              <span className="flex-1 truncate text-left">{item.label}</span>
              {badge > 0 && (
                <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-surface-950 shadow-[0_0_8px_rgba(62,166,255,0.5)]">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
              <svg
                viewBox="0 0 10 16"
                className="h-3.5 w-2.5 shrink-0 fill-current text-slate-500 opacity-0 transition-opacity group-hover:opacity-70"
                aria-hidden
              >
                <circle cx="2.5" cy="3" r="1.2" />
                <circle cx="7.5" cy="3" r="1.2" />
                <circle cx="2.5" cy="8" r="1.2" />
                <circle cx="7.5" cy="8" r="1.2" />
                <circle cx="2.5" cy="13" r="1.2" />
                <circle cx="7.5" cy="13" r="1.2" />
              </svg>
            </button>
          )
        })}
      </nav>

      <div className="border-t border-white/[0.12] p-3">
        <button
          onClick={sync}
          disabled={syncing}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-3 py-2 text-sm font-medium text-surface-950 shadow-[0_0_16px_rgba(62,166,255,0.4)] transition-all hover:bg-accent/90 hover:shadow-[0_0_24px_rgba(62,166,255,0.6)] disabled:opacity-50"
        >
          {syncing ? (
            <Spinner className="border-surface-950/40 border-t-surface-950" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            </svg>
          )}
          Sync bank
        </button>
        <p className="mt-2 text-center text-[10px] text-slate-500">
          {bankStatus
            ? `${bankStatus.accounts} account${bankStatus.accounts === 1 ? '' : 's'} · ${bankStatus.transactions} tx`
            : 'Not synced yet'}
        </p>
      </div>
    </aside>
  )
}
