const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' })
const nzdWhole = new Intl.NumberFormat('en-NZ', {
  style: 'currency',
  currency: 'NZD',
  maximumFractionDigits: 0
})

export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return nzd.format(n)
}

export function moneyWhole(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return nzdWhole.format(n)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' })
}

/** A millisecond timestamp rendered as a local NZ date. */
export function timestampDate(ts: number | null | undefined): string {
  if (ts == null) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Pacific/Auckland'
  })
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-NZ', {
    month: 'short',
    year: '2-digit',
    timeZone: 'Pacific/Auckland'
  })
}
