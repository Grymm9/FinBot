import type { AlertResult } from '@shared/types'

/**
 * Pure helpers for budget notifications.
 *
 * Pacing flags (projected spend vs budget) are still useful in the UI, but a
 * Discord notification is only sent for categories whose actual spend is
 * already over budget.
 */

export type BudgetFlag = AlertResult['flags'][number]

const cents = (n: number): number => Math.round(n * 100)

/** Categories that have actually exceeded their budget (strictly over). */
export function exceededBudgets(flags: BudgetFlag[]): BudgetFlag[] {
  return flags
    .filter((f) => f.budgeted > 0 && cents(f.spent) > cents(f.budgeted))
    .sort((a, b) => b.spent / b.budgeted - a.spent / a.budgeted || b.spent - a.spent)
}

export function exceededAlertMessage(cycleLabel: string, exceeded: BudgetFlag[]): string {
  const list = exceeded
    .map((f) => {
      const over = f.spent - f.budgeted
      return `• **${f.category}**: $${f.spent.toFixed(2)} spent vs $${f.budgeted.toFixed(2)} budget ($${over.toFixed(2)} over)`
    })
    .join('\n')
  return `🚨 **Budget exceeded** (cycle starting ${cycleLabel}):\n${list}\n\nConsider rebalancing before your next payday.`
}

/**
 * Dedupe key: one notification per distinct set of over-budget categories in a
 * cycle. Adding a newly exceeded category sends a fresh update; nothing else
 * is repeated every six hours.
 */
export function overspendKey(cycleStart: string, exceeded: BudgetFlag[]): string {
  return `${cycleStart}|${exceeded
    .map((f) => f.category)
    .sort()
    .join('|')}`
}
