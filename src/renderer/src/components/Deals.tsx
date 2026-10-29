import { useEffect, useState } from 'react'
import type { DealCategory, DealComparison, DealsReport } from '@shared/types'
import { Badge, Button, Card, EmptyState, SectionHeader, Spinner, StatCard } from './ui'
import { formatDate, money, moneyWhole, timestampDate } from '../lib/format'

const fieldCls =
  'mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none'
const labelCls = 'block text-xs font-medium text-slate-400'

const CATEGORIES: Array<{ id: DealCategory; label: string; blurb: string }> = [
  { id: 'power', label: 'Power', blurb: 'Ranked on your real monthly usage, not the headline c/kWh.' },
  { id: 'broadband', label: 'Broadband', blurb: 'Public monthly plans, ranked by price.' },
  { id: 'mobile', label: 'Mobile', blurb: 'Prepay and pay-monthly plans, normalised to a month.' }
]

const EMPTY_FORM = {
  provider: '',
  planName: '',
  monthlyPrice: '',
  variableRate: '',
  dailyCharge: '',
  sourceUrl: '',
  notes: ''
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function Deals(): JSX.Element {
  const [report, setReport] = useState<DealsReport | null>(null)
  const [tab, setTab] = useState<DealCategory>('power')
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [usage, setUsage] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM })

  const load = async (): Promise<void> => {
    try {
      const r = await window.api.getDeals()
      setReport(r)
      setUsage((prev) => (prev === '' ? String(r.powerUsageKwh) : prev))
    } catch (e) {
      setNotice(errorText(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    setNotice('')
    try {
      const r = await window.api.refreshDeals()
      setReport(r)
      setUsage(String(r.powerUsageKwh))
      setNotice('Prices re-checked against the retailers’ pages.')
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setRefreshing(false)
    }
  }

  const saveUsage = async (): Promise<void> => {
    const kwh = Number(usage)
    if (!Number.isFinite(kwh) || kwh <= 0) {
      setNotice('Enter your monthly usage in kWh.')
      return
    }
    try {
      setReport(await window.api.setPowerUsage(kwh))
      setNotice('Usage updated — power plans repriced.')
    } catch (e) {
      setNotice(errorText(e))
    }
  }

  const set = (key: keyof typeof form, value: string): void => setForm({ ...form, [key]: value })

  const addPlan = async (): Promise<void> => {
    if (!form.provider.trim() || !form.planName.trim()) {
      setNotice('Give the plan a provider and a name.')
      return
    }
    try {
      const r = await window.api.addDealPlan({
        category: tab,
        provider: form.provider,
        planName: form.planName,
        monthlyPrice: tab === 'power' ? null : Number(form.monthlyPrice),
        variableRate: tab === 'power' ? Number(form.variableRate) : null,
        dailyCharge: tab === 'power' ? Number(form.dailyCharge) : null,
        sourceUrl: form.sourceUrl || null,
        notes: form.notes || null
      })
      setReport(r)
      setForm({ ...EMPTY_FORM })
      setNotice('Plan added.')
    } catch (e) {
      setNotice(errorText(e))
    }
  }

  const removePlan = async (id: number, label: string): Promise<void> => {
    if (!confirm(`Remove "${label}" from your catalogue?`)) return
    try {
      setReport(await window.api.deleteDealPlan(id))
      setNotice('Plan removed.')
    } catch (e) {
      setNotice(errorText(e))
    }
  }

  const current = report?.comparisons.find((c) => c.category === tab) ?? null
  const totalSaving =
    report?.comparisons.reduce((sum, c) => sum + c.bestSaveMonthly * 12, 0) ?? 0

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Deals"
        subtitle="Power, broadband and phone: what you're paying now against the cheapest plan the app can verify. Every price carries the date it was checked."
        action={
          <Button
            variant="secondary"
            className="whitespace-nowrap"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing && <Spinner />}
            {refreshing ? 'Checking…' : 'Re-check prices'}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Best annual saving"
          value={moneyWhole(totalSaving)}
          sub={totalSaving > 0 ? 'If you took the cheapest listed plan in each category' : 'No like-for-like saving found yet'}
          tone={totalSaving > 0 ? 'good' : 'neutral'}
        />
        <StatCard
          label="Prices last checked"
          value={report?.lastChecked ? timestampDate(report.lastChecked) : 'Not yet'}
          sub={report?.lastChecked ? 'Retailer pages re-fetched weekly' : 'Add a plan or press re-check'}
        />
        <StatCard
          label="Power usage"
          value={report ? `${report.powerUsageKwh} kWh` : '—'}
          sub="Per month, used to price power plans"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const comparison = report?.comparisons.find((x) => x.category === c.id)
          const active = tab === c.id
          return (
            <button
              key={c.id}
              onClick={() => {
                setTab(c.id)
                setForm({ ...EMPTY_FORM })
                setNotice('')
              }}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                active
                  ? 'border-accent/40 bg-accent/10 text-slate-100'
                  : 'border-white/[0.12] bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200'
              }`}
            >
              {c.label}
              {comparison && comparison.offers.length > 0 && (
                <span className="ml-2 text-[11px] text-slate-500">{comparison.offers.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {notice && <p className="text-xs text-accent">{notice}</p>}

      {!report || !current ? (
        <EmptyState title="Loading deals…" hint="Reading the local catalogue and recent bills." />
      ) : (
        <Comparison
          comparison={current}
          blurb={CATEGORIES.find((c) => c.id === tab)?.blurb ?? ''}
          usage={usage}
          setUsage={setUsage}
          saveUsage={() => void saveUsage()}
          onRemove={(id, label) => void removePlan(id, label)}
          onOpenCompare={() => void window.api.openDealCompare(current.category)}
        />
      )}

      {report && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">
                Add a {CATEGORIES.find((c) => c.id === tab)?.label.toLowerCase()} plan
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Enter a plan from a recent bill or a retailer page. A source URL lets the weekly
                check flag it if the page stops listing it.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <label className={`${labelCls} sm:col-span-2`}>
              Provider
              <input
                value={form.provider}
                onChange={(e) => set('provider', e.target.value)}
                placeholder={tab === 'power' ? 'Contact Energy' : 'Skinny'}
                className={fieldCls}
              />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              Plan name
              <input
                value={form.planName}
                onChange={(e) => set('planName', e.target.value)}
                placeholder={tab === 'power' ? 'Standard user' : 'Fibre 300/100'}
                className={fieldCls}
              />
            </label>

            {tab === 'power' ? (
              <>
                <label className={labelCls}>
                  Daily charge ($/day)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.dailyCharge}
                    onChange={(e) => set('dailyCharge', e.target.value)}
                    placeholder="2.10"
                    className={fieldCls}
                  />
                </label>
                <label className={labelCls}>
                  Rate ($/kWh)
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    value={form.variableRate}
                    onChange={(e) => set('variableRate', e.target.value)}
                    placeholder="0.245"
                    className={fieldCls}
                  />
                </label>
                <p className="self-end text-[11px] text-slate-500 sm:col-span-2">
                  Use the GST-inclusive figures from the bill. 24.5c/kWh = 0.245.
                </p>
              </>
            ) : (
              <label className={labelCls}>
                Monthly price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.monthlyPrice}
                  onChange={(e) => set('monthlyPrice', e.target.value)}
                  placeholder="75.00"
                  className={fieldCls}
                />
              </label>
            )}

            <label className={`${labelCls} sm:col-span-2`}>
              Source URL (optional)
              <input
                value={form.sourceUrl}
                onChange={(e) => set('sourceUrl', e.target.value)}
                placeholder="https://…"
                className={fieldCls}
              />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              Note (optional)
              <input
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="12-month term, BYO modem"
                className={fieldCls}
              />
            </label>
          </div>

          <div>
            <Button onClick={() => void addPlan()}>Add plan</Button>
          </div>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Insurance renewals</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              A Discord nudge goes out a week before each renewal. Premiums are individually
              priced, so this is a manual review — not an automated comparison.
            </p>
          </div>
          {report && report.renewals.length > 0 && (
            <Badge tone={report.renewals.some((r) => r.daysAway <= 7) ? 'bad' : 'warn'}>
              {report.renewals.length} upcoming
            </Badge>
          )}
        </div>

        {!report || report.renewals.length === 0 ? (
          <p className="text-xs text-slate-500">
            No insurance renewals in the next 30 days. Upload a renewal notice on the Insurance page
            to have it tracked here.
          </p>
        ) : (
          <div className="space-y-2">
            {report.renewals.map((r) => (
              <div
                key={`${r.policyId}-${r.renewalDate}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-100">
                    {r.provider ?? r.coverType ?? 'Insurance policy'}
                    {r.coverType && r.coverType !== r.provider && (
                      <span className="text-slate-400"> · {r.coverType}</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    Renews {formatDate(r.renewalDate)}
                    {r.premium != null && ` · ${money(r.premium)} ${r.frequency ?? ''}`.trimEnd()}
                  </p>
                </div>
                <Badge tone={r.daysAway <= 7 ? 'bad' : 'warn'}>
                  {r.daysAway === 0 ? 'Renews today' : `${r.daysAway} day${r.daysAway === 1 ? '' : 's'} away`}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Comparison({
  comparison,
  blurb,
  usage,
  setUsage,
  saveUsage,
  onRemove,
  onOpenCompare
}: {
  comparison: DealComparison
  blurb: string
  usage: string
  setUsage: (v: string) => void
  saveUsage: () => void
  onRemove: (id: number, label: string) => void
  onOpenCompare: () => void
}): JSX.Element {
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{comparison.label}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{blurb}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {comparison.currentProvider && (
            <Badge>
              Paying {comparison.currentProvider}
              {comparison.currentMonthly != null && ` · ${money(comparison.currentMonthly)}/mo`}
            </Badge>
          )}
          {comparison.bestSaveMonthly > 0 && (
            <Badge tone="good">
              Save {money(comparison.bestSaveMonthly)}/mo · {moneyWhole(comparison.bestSaveAnnual)}/yr
            </Badge>
          )}
        </div>
      </div>

      {comparison.category === 'power' && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
          <label className={labelCls}>
            Your monthly usage (kWh)
            <input
              type="number"
              min={1}
              step="1"
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              className={`${fieldCls} w-40`}
            />
          </label>
          <Button variant="secondary" className="!px-4 !py-2 !text-xs" onClick={saveUsage}>
            Reprice
          </Button>
          <p className="text-[11px] text-slate-500">
            From your bill: units used in the month. Off-peak plans need the split to be exact.
          </p>
        </div>
      )}

      {comparison.note && (
        <p className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-slate-400">
          {comparison.note}
        </p>
      )}

      {comparison.offers.length === 0 ? (
        <EmptyState
          title={`No ${comparison.label.toLowerCase()} plans yet`}
          hint="Add your current plan below, plus one or two alternatives. The ranking updates immediately."
        />
      ) : (
        <div className="space-y-2">
          {comparison.offers.map((o) => (
            <div
              key={o.plan.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{o.plan.provider}</span>
                  {o.isCurrent && <Badge tone="neutral">Current</Badge>}
                  {o.plan.stale && <Badge tone="warn">Unverified</Badge>}
                </div>
                <p className="text-xs text-slate-500">
                  {o.plan.planName}
                  {o.plan.category === 'power' &&
                    o.plan.dailyCharge != null &&
                    o.plan.variableRate != null &&
                    ` · ${money(o.plan.dailyCharge)}/day + ${(o.plan.variableRate * 100).toFixed(1)}c/kWh`}
                  {o.plan.region ? ` · ${o.plan.region}` : ''}
                </p>
                <p className="text-[11px] text-slate-600">
                  {o.plan.verifiedAt
                    ? `${o.plan.sourceUrl ? 'Price checked' : 'Entered'} ${timestampDate(o.plan.verifiedAt)}`
                    : 'Price entered manually'}
                  {o.plan.notes ? ` · ${o.plan.notes}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-100">{money(o.monthlyCost)}</p>
                  <p className="text-[11px] text-slate-500">per month</p>
                  {o.monthlySaving > 0 ? (
                    <p className="text-[11px] text-accent">
                      save {moneyWhole(o.annualSaving)}/yr
                    </p>
                  ) : o.monthlySaving < 0 ? (
                    <p className="text-[11px] text-slate-500">{money(-o.monthlySaving)}/mo more</p>
                  ) : null}
                </div>
                <button
                  onClick={() => onRemove(o.plan.id, `${o.plan.provider} ${o.plan.planName}`)}
                  className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-danger/15 hover:text-danger"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
        <p className="text-[11px] text-slate-500">
          {comparison.staleCount > 0
            ? `${comparison.staleCount} plan${comparison.staleCount === 1 ? '' : 's'} could not be confirmed at the last check. `
            : 'Prices are read from public retailer pages — no affiliate links. '}
          Savings are price differences against what you pay now; check allowances, speeds and
          contract terms before switching.
        </p>
        <Button variant="ghost" className="!px-3 !py-1.5 !text-xs" onClick={onOpenCompare}>
          Open comparison site ↗
        </Button>
      </div>
    </Card>
  )
}
