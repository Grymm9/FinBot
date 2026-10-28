import type { DashboardSummary } from '@shared/types'
import {
  Card,
  EmptyState,
  ProgressBar,
  SectionHeader,
  StatCard,
  Spinner
} from './ui'
import { money, moneyWhole, shortDate } from '../lib/format'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Area,
  AreaChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

export default function Dashboard({
  summary,
  refreshing,
  onSync
}: {
  summary: DashboardSummary | null
  refreshing: boolean
  onSync: () => void
}): JSX.Element {
  if (!summary) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        {refreshing ? <Spinner className="h-6 w-6" /> : 'Loading…'}
      </div>
    )
  }

  const chartData = summary.cashFlow.map((c) => ({
    name: c.label,
    Income: c.income,
    Expenses: c.expense
  }))

  const tooltipStyle = {
    backgroundColor: '#0b0f1a',
    border: '1px solid #1c2536',
    borderRadius: 8,
    color: '#e2e8f0'
  }

  const pieData = summary.categories
    .filter((c) => c.budgeted > 0)
    .sort((a, b) => b.budgeted - a.budgeted)
    .map((c) => ({ name: c.category, value: c.budgeted }))

  const forecast = summary.forecast
  const forecastData = forecast.points.map((p) => ({ date: shortDate(p.date), Balance: p.balance }))
  const upcoming = forecast.events.filter((e) => e.kind !== 'income').slice(0, 5)

  const PIE_COLORS = [
    '#22d3aa',
    '#60a5fa',
    '#f87171',
    '#fbbf24',
    '#a78bfa',
    '#f472b6',
    '#34d399',
    '#fb923c',
    '#38bdf8',
    '#e879f9',
    '#4ade80',
    '#facc15'
  ]

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Dashboard"
        subtitle={`Income cycle ${summary.cycleRange} — internal transfers and disabled accounts are excluded.`}
        action={
          <button
            onClick={onSync}
            className="rounded-full border border-white/[0.16] bg-white/[0.06] px-3 py-1.5 text-sm text-slate-200 hover:bg-white/[0.11] backdrop-blur-[20px] backdrop-saturate-[1.8]"
          >
            Refresh
          </button>
        }
      />

      <p className="-mt-3 text-xs text-slate-500">
        Timezone: {summary.timeZone || 'Pacific/Auckland'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">Services</span>
        {summary.health.map((h) => {
          const dot =
            h.status === 'ok'
              ? 'bg-accent'
              : h.status === 'warn'
                ? 'bg-warn'
                : h.status === 'fail'
                  ? 'bg-danger'
                  : 'bg-slate-600'
          const label =
            h.status === 'fail'
              ? 'failing'
              : h.status === 'warn'
                ? 'retrying'
                : h.status === 'unknown'
                  ? 'idle'
                  : null
          return (
            <span
              key={h.service}
              title={
                h.lastError
                  ? `${h.label}: ${h.lastError}${h.lastErrorAt ? ` (${new Date(h.lastErrorAt).toLocaleString('en-NZ')})` : ''}`
                  : h.lastOk
                    ? `${h.label}: last OK ${new Date(h.lastOk).toLocaleString('en-NZ')}`
                    : `${h.label}: no activity yet`
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400 backdrop-blur-[20px]"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              {h.label}
              {label && <span className="text-slate-500">· {label}</span>}
            </span>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Budget this cycle" value={moneyWhole(summary.totalBudgeted)} sub="total across categories" />
        <StatCard label="Spent this cycle" value={moneyWhole(summary.totalSpent)} sub="real spending to date" />
        <StatCard
          label="Remaining"
          value={moneyWhole(summary.totalRemaining)}
          tone={summary.totalRemaining < 0 ? 'bad' : 'good'}
          sub={summary.totalRemaining < 0 ? 'over budget' : 'left to spend'}
        />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Cash flow to payday</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Today to {shortDate(forecast.endDate)} — committed bills, subscriptions and remaining budget.
            </p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Today</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">{money(forecast.startBalance)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Lowest</p>
              <p
                className={`text-lg font-semibold tabular-nums ${
                  forecast.minBalance < 0 ? 'text-danger' : forecast.minBalance < 100 ? 'text-warn' : 'text-slate-100'
                }`}
              >
                {money(forecast.minBalance)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">On payday</p>
              <p className="text-lg font-semibold tabular-nums text-accent">{money(forecast.projectedEnd)}</p>
            </div>
          </div>
        </div>

        {forecastData.length > 1 ? (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecastData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3ea6ff" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3ea6ff" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c2536" />
                <XAxis dataKey="date" stroke="#475569" fontSize={11} interval="preserveStartEnd" />
                <YAxis stroke="#475569" fontSize={11} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(Number(value))} />
                <ReferenceLine y={0} stroke="#f87171" strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="Balance"
                  stroke="#3ea6ff"
                  strokeWidth={2}
                  fill="url(#forecastFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState title="Not enough data to forecast" hint="Sync your bank and import a budget." />
        )}

        {forecast.warnings.length > 0 && (
          <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {forecast.warnings.join(' ')}
          </p>
        )}

        {upcoming.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {upcoming.map((e, i) => (
              <div key={`${e.date}-${i}`} className="flex items-center justify-between text-xs">
                <span className="truncate text-slate-400">
                  <span className="tabular-nums text-slate-500">{shortDate(e.date)}</span> · {e.label}
                  {e.estimated && <span className="text-slate-600"> (est.)</span>}
                </span>
                <span className="ml-3 shrink-0 tabular-nums text-slate-300">{money(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Cash flow</h3>
          {chartData.every((c) => c.Income === 0 && c.Expenses === 0) ? (
            <EmptyState title="No transaction history yet" hint="Sync your bank account to see income vs expenses." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2536" />
                  <XAxis dataKey="name" stroke="#475569" fontSize={12} />
                  <YAxis stroke="#475569" fontSize={12} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => money(Number(value))}
                  />
                  <Bar dataKey="Income" fill="#22d3aa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Budget breakdown</h3>
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
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={1}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#0b0f1a" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 truncate text-slate-300">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      {d.name}
                    </span>
                    <span className="tabular-nums text-slate-400">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Budget progress</h3>
          {summary.categories.length === 0 ? (
            <EmptyState
              title="No budget categories"
              hint="Import a baseline budget CSV from the Budgets tab."
            />
          ) : (
            <div className="space-y-4">
              {summary.categories
                .filter((c) => c.budgeted > 0 || c.spent > 0)
                .sort((a, b) => b.spent - a.spent)
                .map((c) => (
                  <div key={c.category}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-slate-200">{c.category}</span>
                      <span className="tabular-nums text-slate-400">
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
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Recent transactions</h3>
          {summary.recentTransactions.length === 0 ? (
            <EmptyState title="No transactions" hint="Sync your bank to see recent activity." />
          ) : (
            <ul className="divide-y divide-surface-800">
              {summary.recentTransactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">{t.description}</p>
                    <p className="text-xs text-slate-500">{shortDate(t.date)}</p>
                  </div>
                  <span
                    className={`ml-3 shrink-0 text-sm font-medium tabular-nums ${
                      t.amount >= 0 ? 'text-accent' : 'text-slate-300'
                    }`}
                  >
                    {money(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {summary.review && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-200">Last cycle — {summary.review.label}</h3>
            <span className="text-[11px] text-slate-500">
              written {new Date(summary.review.createdAt).toLocaleDateString('en-NZ')}
            </span>
          </div>
          <p className="mt-2 text-base font-medium text-accent">{summary.review.headline}</p>
          <div className="mt-2 space-y-1">
            {summary.review.body.split('\n').map((line, i) => (
              <p key={i} className="text-sm text-slate-400">
                • {line}
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
