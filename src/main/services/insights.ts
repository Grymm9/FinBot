import { getDb } from '../db'
import { REAL_TX } from './filters'
import { currentCycleRange } from './cycle'
import { listSubscriptions } from './subscriptions'
import { listPolicies } from './insurance'
import { checkExpectedPayments } from './payments'
import { daysBetween, round2 } from './reconcile-math'
import { todayLocalIso, localIsoDate } from './dates'
import { getSettingNumber } from './settings'
import { dismissedKeys } from './notifications'
import type { Insight } from '@shared/types'

/**
 * Cross-cutting spending insights that are not part of the budget pacing
 * alerts: low balance before upcoming transfers, unusually large debits,
 * subscription price rises, and insurance renewals.
 *
 * Every insight carries a stable `key` so it can be dismissed per cycle
 * (reusing the `dismissed_alerts` table).
 */

const SEVERITY_ORDER: Record<Insight['severity'], number> = { bad: 0, warn: 1, info: 2 }

function lowBalance(): Insight | null {
  const cycle = currentCycleRange()
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(b.available), 0) AS v
       FROM balances b JOIN accounts a ON a.id = b.account_id
       WHERE a.enabled = 1 AND COALESCE(a.type, '') != 'LOAN'`
    )
    .get() as { v: number }

  const available = round2(row.v)
  const missed = checkExpectedPayments()
  const required = round2(missed.reduce((s, m) => s + m.amount, 0))
  const buffer = getSettingNumber('LOW_BALANCE_BUFFER', 50)

  if (required <= 0) return null
  if (available >= required + buffer) return null

  return {
    key: `lowbal:${cycle.start}`,
    type: 'low_balance',
    severity: 'bad',
    title: 'Balance may not cover remaining transfers',
    detail: `$${available.toFixed(2)} available vs $${required.toFixed(2)} still to fund this cycle.`,
    amount: required
  }
}

function largeTransactions(): Insight[] {
  const db = getDb()
  const days = Math.max(1, getSettingNumber('LARGE_TX_DAYS', 3))
  const since = localIsoDate(new Date(Date.now() - days * 86400000))

  const window = db
    .prepare(
      `SELECT id, date, description, amount, merchant FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? ORDER BY amount ASC`
    )
    .all(since) as Array<{ id: string; date: string; description: string; amount: number; merchant: string | null }>

  if (window.length === 0) return []

  // Baseline: median debit over the last 90 days so the threshold adapts to
  // the user's normal spending rather than a fixed number.
  const baseline = db
    .prepare(
      `SELECT amount FROM transactions
       WHERE ${REAL_TX} AND amount < 0 AND date >= ? ORDER BY amount ASC`
    )
    .all(localIsoDate(new Date(Date.now() - 90 * 86400000))) as Array<{ amount: number }>

  const amounts = baseline.map((b) => Math.abs(b.amount)).sort((a, b) => a - b)
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0
  const threshold = Math.max(getSettingNumber('LARGE_TX_MIN', 300), median * 3)

  const out: Insight[] = []
  for (const t of window) {
    const amt = Math.abs(t.amount)
    if (amt < threshold) continue
    const label = t.merchant ?? t.description
    out.push({
      key: `large:${t.id}`,
      type: 'large_transaction',
      severity: 'warn',
      title: `Large transaction: ${label}`,
      detail: `$${amt.toFixed(2)} on ${t.date} — larger than ${Math.round(threshold)} and well above your usual spend.`,
      amount: round2(amt),
      date: t.date
    })
  }
  // Dedupe by key (a transaction can only appear once anyway) and cap noise.
  const seen = new Set<string>()
  return out.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))).slice(0, 5)
}

function subscriptionRises(): Insight[] {
  return listSubscriptions()
    .filter((s) => s.priceRose)
    .map((s) => ({
      key: `subrise:${s.key}:${s.lastDate}`,
      type: 'subscription_rise' as const,
      severity: 'warn' as const,
      title: `${s.merchant} price increased`,
      detail: `$${(s.previousAmount ?? 0).toFixed(2)} → $${s.amount.toFixed(2)} (${s.cadence}).`,
      amount: s.amount,
      date: s.lastDate
    }))
}

function insuranceRenewals(): Insight[] {
  const today = todayLocalIso()
  const out: Insight[] = []
  for (const p of listPolicies()) {
    if (!p.renewalDate) continue
    const days = daysBetween(today, p.renewalDate)
    if (days < 0 || days > 30) continue
    const name = p.provider ?? p.coverType ?? 'Insurance policy'
    const premiumBit = p.premium ? ` · $${p.premium.toFixed(2)} ${p.frequency ?? ''}`.trimEnd() : ''
    const reviewBit = days <= 7 ? ' · review and compare cover before it auto-renews' : ''
    out.push({
      key: `renewal:${p.id}:${p.renewalDate}`,
      type: 'insurance_renewal',
      severity: days <= 7 ? 'bad' : 'warn',
      title: `${name} renews in ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}`,
      detail: `${p.coverType ? p.coverType + ' · ' : ''}renews ${p.renewalDate}${premiumBit}${reviewBit}`,
      date: p.renewalDate
    })
  }
  return out
}

/** All active insights, most severe first. Dismissed ones are excluded. */
export function detectInsights(): Insight[] {
  const low = lowBalance()
  const all = [...(low ? [low] : []), ...largeTransactions(), ...subscriptionRises(), ...insuranceRenewals()]
  const dismissed = dismissedKeys()
  return all
    .filter((i) => !dismissed.has(i.key))
    .sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (s !== 0) return s
      return (b.date ?? '').localeCompare(a.date ?? '')
    })
}
