import { getDb } from '../db'
import { listCategories, computeBudgetStatus, totalReimbursements } from './budget'
import { listCategoryDestinations, listGroups } from './groups'
import { listPolicies } from './insurance'
import { listEmails } from './email'
import { listUserReminders } from './reminders'
import { memoriesForContext } from './memory'
import { listSubscriptions, subscriptionMonthlyTotal } from './subscriptions'
import { goalProgress, listGoals } from './goals'
import { listCycleHistory, topCategoryVariance } from './history'
import { detectInsights } from './insights'
import { buildCashFlowForecast } from './forecast'
import { latestReview } from './reviews'
import { splitsByTransaction } from './transaction-splits'
import { REAL_TX } from './filters'
import { currentCycleRange } from './cycle'

/**
 * Build a compact, read-only JSON snapshot of the user's financial state that
 * is injected into the DeepSeek system prompt. This is how the AI gets "read
 * access" to the SQLite database (budget state, transactions, insurance, etc.)
 * while keeping secrets out of the conversation.
 */
export function buildFinancialContext(): string {
  const db = getDb()
  const cycle = currentCycleRange()

  const balances = db
    .prepare(
      `SELECT a.name, b.current, b.available FROM balances b JOIN accounts a ON a.id = b.account_id`
    )
    .all() as Array<{ name: string; current: number; available: number }>

  const recentTx = db
    .prepare(
      `SELECT id, date, description, amount FROM transactions WHERE ${REAL_TX} ORDER BY date DESC, id DESC LIMIT 50`
    )
    .all() as Array<{ id: string; date: string; description: string; amount: number }>
  const recentSplits = splitsByTransaction(recentTx.map((t) => t.id))

  const categories = listCategories()
  const budgetStatus = computeBudgetStatus(cycle.start, cycle.end)
  const categoryDestinations = new Map(
    listCategoryDestinations().map((entry) => [entry.category, entry.destinations])
  )
  const accountNames = destinationAccountNames()
  const categorySchedules = new Map(categories.map((c) => [c.name, c.frequency]))
  const policies = listPolicies()
  const subs = listSubscriptions()
  const cycles = listCycleHistory(3)

  const income = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE ${REAL_TX} AND amount > 0 AND date >= ? AND date < ?`)
    .get(cycle.start, cycle.end) as { v: number }
  const expense = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE ${REAL_TX} AND amount < 0 AND date >= ? AND date < ?`)
    .get(cycle.start, cycle.end) as { v: number }
  const reimbursements = totalReimbursements(cycle.start, cycle.end)

  const snapshot = {
    asOf: new Date().toISOString(),
    cycle: { label: cycle.label, start: cycle.start, end: cycle.end },
    balances: balances.map((b) => ({
      account: b.name,
      current: b.current,
      available: b.available
    })),
    cycleTotals: {
      income: income.v - reimbursements,
      expense: Math.abs(expense.v),
      net: income.v - reimbursements - Math.abs(expense.v)
    },
    budget: {
      // Totals are provided so the model doesn't have to add 20+ numbers and
      // get it wrong (it used to).
      totalBudgeted: round2(budgetStatus.reduce((s, c) => s + c.budgeted, 0)),
      totalSpent: round2(budgetStatus.reduce((s, c) => s + c.spent, 0)),
      totalRemaining: round2(budgetStatus.reduce((s, c) => s + c.budgeted - c.spent, 0)),
      categories: categories.map((c) => c.name),
      status: budgetStatus.map((c) => {
        const routed = categoryDestinations.get(c.category) ?? []
        const schedule = categorySchedules.get(c.category) ?? 'monthly'
        const destinations = routed.map((d) => ({
          accountName: d.accountNumber ? accountNames.get(compactAccountNumber(d.accountNumber)) ?? null : null,
          accountNumber: d.accountNumber,
          transferLabel: d.transferLabel,
          amount: d.amount ?? c.budgeted,
          schedule
        }))
        return {
          ...c,
          // One routing object in the usual case; an array when the item is
          // split across several destination accounts; null when it has none.
          destination:
            destinations.length === 0 ? null : destinations.length === 1 ? destinations[0] : destinations
        }
      })
    },
    groups: listGroups().map((g) => ({
      items: g.items,
      sum: g.sum,
      destinations: g.destinations.map((d) => ({
        amount: d.amount ?? g.sum,
        accountNumber: d.accountNumber,
        accountType: d.accountType,
        transferLabel: d.transferLabel
      }))
    })),
    insurancePolicies: policies.map((p) => ({
      provider: p.provider,
      coverType: p.coverType,
      premium: p.premium,
      renewalDate: p.renewalDate,
      linkedToTransaction: !!p.linkedTransactionId
    })),
    emails: listEmails()
      .filter((e) => e.relevant)
      .slice(0, 20)
      .map((e) => ({
        subject: e.subject,
        from: e.from,
        date: e.date,
        keywords: e.keywords
      })),
    reminders: listUserReminders().map((r) => ({
      id: r.id,
      message: r.message,
      targetDate: r.targetDate,
      repeat: r.repeat
    })),
    memories: memoriesForContext(),
    subscriptions: {
      monthlyTotal: subscriptionMonthlyTotal(subs),
      items: subs.slice(0, 12).map((s) => ({
        merchant: s.merchant,
        amount: s.amount,
        cadence: s.cadence,
        monthlyAmount: s.monthlyAmount,
        priceRose: s.priceRose
      }))
    },
    goals: listGoals().map((g) => {
      const p = goalProgress(g)
      return {
        name: g.name,
        target: g.targetAmount,
        saved: g.savedAmount,
        targetDate: g.targetDate,
        perWeekNeeded: p.perWeek
      }
    }),
    recentCycles: cycles,
    lastCycleVariance: cycles.length > 0 ? topCategoryVariance(cycles[0].cycleStart, 5) : [],
    insights: detectInsights().map((i) => ({ type: i.type, title: i.title, detail: i.detail })),
    forecast: forecastSnapshot(),
    lastCycleReview: latestReview(),
    recentTransactions: recentTx.map((t) => {
      const splits = recentSplits.get(t.id)
      return {
        id: t.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        ...(splits && splits.length > 0
          ? { splits: splits.map((s) => ({ category: s.category, amount: s.amount })) }
          : {})
      }
    })
  }

  return JSON.stringify(snapshot, null, 2)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const compactAccountNumber = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Map a bank account number to its display name using the Akahu `raw` payload
 * already stored on each account. Destination routing only stores the number,
 * so this is how we add the name without changing any schema.
 */
function destinationAccountNames(): Map<string, string> {
  const rows = getDb().prepare('SELECT name, raw FROM accounts').all() as Array<{
    name: string
    raw: string | null
  }>
  const names = new Map<string, string>()
  for (const row of rows) {
    try {
      const raw = JSON.parse(row.raw ?? '{}') as { formatted_account?: unknown }
      if (typeof raw.formatted_account === 'string' && raw.formatted_account.trim()) {
        names.set(compactAccountNumber(raw.formatted_account), row.name)
      }
    } catch {
      // A malformed raw payload should not break the AI context.
    }
  }
  return names
}

/** Forecast for the prompt snapshot — never let a data problem break chat. */
function forecastSnapshot(): Record<string, unknown> | null {
  try {
    const f = buildCashFlowForecast()
    return {
      payday: f.endDate,
      startBalance: f.startBalance,
      projectedOnPayday: f.projectedEnd,
      lowestBalance: f.minBalance,
      lowestDate: f.minDate,
      committedRemaining: f.committed,
      subscriptionsRemaining: f.subscriptions,
      discretionaryRemaining: f.discretionary,
      warnings: f.warnings,
      upcoming: f.events.slice(0, 10)
    }
  } catch (e) {
    console.error('Forecast for context failed:', e)
    return null
  }
}
