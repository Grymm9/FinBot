/**
 * Date helpers. FinanceBot runs in New Zealand, so all date-only values are
 * produced from LOCAL calendar components — never `Date#toISOString()`, which
 * shifts to UTC and lands a day earlier during NZST/NZDT.
 */

const DEFAULT_TZ = 'Pacific/Auckland'

/** Format a Date as a local YYYY-MM-DD string (no UTC conversion). */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today's date as a local YYYY-MM-DD string. */
export function todayLocalIso(): string {
  return localIsoDate(new Date())
}

/** Parse a YYYY-MM-DD string as a LOCAL date (midnight), avoiding the UTC
 *  interpretation of `new Date('YYYY-MM-DD')`. */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Detect the system IANA timezone, falling back to Pacific/Auckland. */
export function detectTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && tz !== 'UTC') return tz
  } catch {
    /* ignore */
  }
  return DEFAULT_TZ
}

/** Whether a value is a date-only string (YYYY-MM-DD) with no time component. */
export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

/**
 * Convert a transaction timestamp to a local calendar date (YYYY-MM-DD) in
 * the given IANA timezone.
 *
 *   - Full UTC instants (e.g. "2026-10-13T11:56:00Z") are converted to local
 *     time first, then the date is extracted. A transaction at 00:56 NZDT on
 *     14 Oct (11:56 UTC on 13 Oct) correctly becomes "2026-10-14".
 *   - Timestamps with an explicit offset (e.g. "2026-10-14T00:56:00+13:00")
 *     are treated as instants and converted to the target timezone.
 *   - Date-only strings (e.g. "2026-10-13") are already local calendar dates
 *     and are returned unchanged (no offset applied — applying one would shift
 *     them the other way).
 */
export function toLocalDate(value: string, timeZone: string): string {
  if (!value) return value
  const trimmed = value.trim()
  if (isDateOnly(trimmed)) return trimmed

  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return trimmed.slice(0, 10)

  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const parts = fmt.formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value
    const m = parts.find((p) => p.type === 'month')?.value
    const day = parts.find((p) => p.type === 'day')?.value
    if (y && m && day) return `${y}-${m}-${day}`
  } catch {
    /* invalid timezone — fall through to slicing the instant's own date */
  }
  return trimmed.slice(0, 10)
}

/** Convert a timestamp to a local date using the system timezone. */
export function toLocalDateAuto(value: string): string {
  return toLocalDate(value, detectTimeZone())
}
