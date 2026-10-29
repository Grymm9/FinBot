import type { DashboardSummary } from '@shared/types'
import { Card, EmptyState, ProgressBar, SectionHeader, Spinner } from './ui'
import AiInsightsPanel from './AiInsightsPanel'
import { money, moneyWhole } from '../lib/format'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const PIE_COLORS = [
  '#3ea6ff',
  '#6ec3ff',
  '#22d3aa',
  '#a78bfa',
  '#38bdf8',
  '#f472b6',
  '#fbbf24',
  '#34d399',
  '#818cf8',
  '#f87171',
  '#2dd4bf',
  '#facc15'
]

export default function Dashboard({
  summary,
  refreshing,
  onSync,
  onViewNotifications
}: {
  summary: DashboardSummary | null
  refreshing: boolean
  onSync: () => void
  onViewNotifications: () => void
}): JSX.Element {
  if (!summary) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        {refreshing ? <Spinner className="h-6 w-6" /> : 'Loading…'}
      </div>
    )
  }

  const tooltipStyle = {
    backgroundColor: 'var(--chart-tooltip-bg)',
    border: '1px solid var(--chart-border)',
    borderRadius: 8,
    color: 'var(--chart-text)'
  }

  const pieData = summary.categories
    .filter((c) => c.budgeted > 0)
    .sort((a, b) => b.budgeted - a.budgeted)
    .map((c) => ({ name: c.category, value: c.budgeted }))

  const totalPercent = summary.totalBudgeted > 0 ? (summary.totalSpent / summary.totalBudgeted) * 100 : 0
  const categories = summary.categories
    .filter((c) => c.budgeted > 0 || c.spent > 0)
    .sort((a, b) => b.spent - a.spent)

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Dashboard"
        subtitle={`Income cycle ${summary.cycleRange} — internal transfers and disabled accounts are excluded.`}
        action={
          <button
            onClick={onSync}
            className="rounded-full border border-white/[0.16] bg-white/[0.06] px-3 py-1.5 text-sm text-slate-200 backdrop-blur-[20px] backdrop-saturate-[1.8] hover:bg-white/[0.11]"
          >
            Refresh
          </button>
        }
      />

      <AiInsightsPanel
        alerts={summary.aiAlerts}
        unread={summary.aiUnread}
        onChanged={onSync}
        onViewAll={onViewNotifications}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Budget progress</h3>
              <p className="mt-0.5 text-xs text-slate-500">Allocation, spend and what is left this cycle.</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                totalPercent > 100 ? 'bg-danger/15 text-danger' : 'bg-accent/15 text-accent'
              }`}
            >
              {Math.round(totalPercent)}% used
            </span>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.035] p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Allocated</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">
                {moneyWhole(summary.totalBudgeted)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Spent</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-accent">{moneyWhole(summary.totalSpent)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Remaining</p>
              <p
                className={`mt-0.5 text-lg font-semibold tabular-nums ${
                  summary.totalRemaining < 0 ? 'text-danger' : 'text-slate-100'
                }`}
              >
                {moneyWhole(summary.totalRemaining)}
              </p>
            </div>
          </div>

          <ProgressBar percent={totalPercent} />

          {categories.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No budget categories" hint="Import a baseline budget CSV from the Budgets tab." />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {categories.map((c) => (
                <div key={c.category}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-200">{c.category}</span>
                    <span className="shrink-0 tabular-nums text-slate-400">
                      {money(c.spent)} / {money(c.budgeted)}
                    </span>
                  </div>
                  <ProgressBar percent={c.percent} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-slate-200">Budget breakdown</h3>
          <p className="mb-4 text-xs text-slate-500">Where this cycle's allocation is going.</p>
          {pieData.length === 0 ? (
            <EmptyState title="No budget yet" hint="Import a budget to see the allocation breakdown." />
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={86}
                      paddingAngle={1}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="var(--chart-stroke)" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-300">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="truncate">{d.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">
                      {money(d.value)} ·{' '}
                      {summary.totalBudgeted > 0 ? `${Math.round((d.value / summary.totalBudgeted) * 100)}%` : '0%'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
