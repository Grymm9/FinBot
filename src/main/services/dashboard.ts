import { getDb } from '../db'
import { computeBudgetStatus, totalReimbursements } from './budget'
import { listManualAssets } from './assets'
import { REAL_TX } from './filters'
import { currentCycleRange, recentCycleRanges, cycleLabel } from './cycle'
import { parseLocalDate, detectTimeZone, todayLocalIso } from './dates'
import { checkExpectedPayments, listMatchedPayments } from './payments'
import { detectDuplicateCharges } from './duplicates'
import { detectInsights } from './insights'
import { getHealth } from './health'
import { buildCashFlowForecast } from './forecast'
import { latestReview } from './reviews'
import { refreshAiAlerts } from './ai-alerts'
import type {
  Account,
  AiAlertFeed,
  BalanceInfo,
  CashFlowPoint,
  DashboardSummary,
  Transaction,
  BankStatus
} from '@shared/types'

export function listAccounts(): Account[] {
  const rows = getDb()
    .prepare('SELECT id, name, type, connection_id, status, currency, enabled FROM accounts ORDER BY name COLLATE NOCASE')
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    type: (r.type as string) ?? null,
    connectionId: (r.connection_id as string) ?? null,
    status: (r.status as string) ?? null,
    currency: (r.currency as string) ?? 'NZD',
    enabled: (r.enabled as number) === 1
  }))
}

export function setAccountEnabled(id: string, enabled: boolean): Account[] {
  getDb().prepare('UPDATE accounts SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  return listAccounts()
}

export function listTransactions(limit = 200): Transaction[] {
  const rows = getDb()
    .prepare(
      `SELECT id, account_id, date, description, amount, type, category, merchant FROM transactions
       WHERE ${REAL_TX} ORDER BY date DESC LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as string,
    accountId: (r.account_id as string) ?? null,
    date: r.date as string,
    description: r.description as string,
    amount: r.amount as number,
    type: (r.type as string) ?? null,
    category: (r.category as string) ?? null,
    merchant: (r.merchant as string) ?? null
  }))
}

export function getCashFlow(cycles = 6): CashFlowPoint[] {
  const db = getDb()
  return recentCycleRanges(cycles).map((c) => {
    const income = db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE ${REAL_TX} AND amount > 0 AND date >= ? AND date < ?`)
      .get(c.start, c.end) as { v: number }
    const expense = db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?`)
      .get(c.start, c.end) as { v: number }
    // Reimbursements for split categories are not real income.
    const incomeNet = income.v - totalReimbursements(c.start, c.end)
    return { label: c.label, income: incomeNet, expense: Math.abs(expense.v) }
  })
}

export function getDashboardSummary(): DashboardSummary {
  const cycle = currentCycleRange()
  const status = computeBudgetStatus(cycle.start, cycle.end)
  const totalBudgeted = status.reduce((s, c) => s + c.budgeted, 0)
  const totalSpent = status.reduce((s, c) => s + c.spent, 0)

  const endExclusive = parseLocalDate(cycle.end)
  endExclusive.setDate(endExclusive.getDate() - 1)
  const cycleRange = `${cycle.label} – ${cycleLabel(endExclusive)}`
  const ai = safeAiAlerts()

  return {
    accounts: listAccounts(),
    totalBudgeted: round2(totalBudgeted),
    totalSpent: round2(totalSpent),
    totalRemaining: round2(totalBudgeted - totalSpent),
    categories: status,
    cashFlow: getCashFlow(),
    recentTransactions: listTransactions(12),
    missedPayments: checkExpectedPayments(),
    matchedPayments: listMatchedPayments(),
    duplicateCharges: detectDuplicateCharges(),
    insights: detectInsights(),
    balances: listBalances(),
    manualAssets: listManualAssets(),
    cycleLabel: cycle.label,
    cycleRange,
    timeZone: detectTimeZone(),
    health: getHealth(),
    forecast: safeForecast(cycle.end),
    review: safeReview(),
    aiAlerts: ai.alerts,
    aiUnread: ai.unread
  }
}

/** AI alerts must never stop the Dashboard from rendering. */
function safeAiAlerts(): AiAlertFeed {
  try {
    return refreshAiAlerts()
  } catch (e) {
    console.error('AI alert refresh failed:', e)
    return { alerts: [], unread: 0 }
  }
}

/** The dashboard must still render if the forecast hits bad data. */
function safeForecast(endDate: string): DashboardSummary['forecast'] {
  try {
    return buildCashFlowForecast()
  } catch (e) {
    console.error('Forecast failed:', e)
    const today = todayLocalIso()
    return {
      startDate: today,
      endDate,
      startBalance: 0,
      projectedEnd: 0,
      minBalance: 0,
      minDate: today,
      income: 0,
      committed: 0,
      subscriptions: 0,
      discretionary: 0,
      dailyBurn: 0,
      points: [],
      events: [],
      warnings: ['Could not build a forecast — check Settings → Service health.']
    }
  }
}

function safeReview(): DashboardSummary['review'] {
  try {
    return latestReview()
  } catch (e) {
    console.error('Cycle review failed:', e)
    return null
  }
}

export function getBankStatus(): BankStatus {
  const db = getDb()
  const accounts = db.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }
  const transactions = db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }
  const lastSync = getDb()
    .prepare("SELECT value FROM settings WHERE key = 'last_sync'")
    .get() as { value: string } | undefined
  return {
    accounts: accounts.c,
    transactions: transactions.c,
    lastSync: lastSync?.value ?? null
  }
}

export function listBalances(): BalanceInfo[] {
  const rows = getDb()
    .prepare(
      `SELECT a.name, b.current, b.available, a.enabled
       FROM balances b JOIN accounts a ON a.id = b.account_id
       ORDER BY a.name COLLATE NOCASE`
    )
    .all() as Array<{ name: string; current: number; available: number; enabled: number }>
  return rows.map((r) => ({
    account: r.name,
    current: r.current,
    available: r.available,
    enabled: r.enabled === 1
  }))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
