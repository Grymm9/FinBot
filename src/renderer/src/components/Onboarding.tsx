import { useEffect, useState } from 'react'
import type { Settings as SettingsMap } from '@shared/types'
import { Button } from './ui'
import BrandMark from './BrandMark'
import { shortDate } from '../lib/format'
import { AI_PROVIDERS, aiProviderPreset } from '@shared/ai-providers'

/**
 * First-run setup assistant.
 *
 * Every integration is optional, so each step can be skipped: a user without
 * Akahu can import a statement CSV instead, and AI/Discord/email can be added
 * later from Settings. Answers are written as the user moves forward, so
 * closing the app mid-setup resumes on the same step.
 */

interface Step {
  id: 'welcome' | 'cycle' | 'budget' | 'bank' | 'ai' | 'alerts' | 'finish'
  label: string
  title: string
  blurb: string
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    title: 'Welcome to FinanceBot',
    blurb:
      'A local-first money app: your database, API keys and bank tokens stay on this PC. Nothing is uploaded except the bank and AI calls you explicitly configure.'
  },
  {
    id: 'cycle',
    label: 'Pay cycle',
    title: 'When do you get paid?',
    blurb:
      'FinanceBot measures spending from payday to payday rather than by calendar month. This drives every budget, alert and forecast in the app.'
  },
  {
    id: 'budget',
    label: 'Budget',
    title: 'Set a baseline budget',
    blurb:
      'Import a CSV of category + monthly amount, or start with an empty budget and add lines in the Budgets page. You can change everything later.'
  },
  {
    id: 'bank',
    label: 'Bank',
    title: 'Connect your bank (or import a statement)',
    blurb:
      'Akahu is New Zealand open banking: connect once and transactions stay in sync. No Akahu? Import a CSV export from your bank instead.'
  },
  {
    id: 'ai',
    label: 'AI helper',
    title: 'Optional: add the AI advisor',
    blurb:
      'Connect the AI you already use — DeepSeek, ChatGPT (OpenAI), Claude or Gemini. The chat can read your budget and transaction snapshot to answer questions and make changes you approve. It needs your own API key.'
  },
  {
    id: 'alerts',
    label: 'Alerts',
    title: 'Optional: phone alerts on Discord',
    blurb:
      'Get a Discord message when a category is pacing over budget or a subscription quietly rises in price. This is a one-way webhook and is entirely optional.'
  },
  {
    id: 'finish',
    label: 'Finish',
    title: 'You are set up',
    blurb: 'Review what is connected. Anything you skipped can be added later from Settings or the setup assistant.'
  }
]

const fieldCls =
  'w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-accent focus:outline-none'

const labelCls = 'block text-xs font-medium text-slate-400'

export default function Onboarding({ onDone }: { onDone: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [masked, setMasked] = useState<SettingsMap>({})

  const [cycle, setCycle] = useState({ frequency: 'monthly', day: '15', weekend: 'previous', anchor: '' })
  const [cyclePreview, setCyclePreview] = useState<{ start: string; end: string; label: string } | null>(null)

  const [accountName, setAccountName] = useState('')
  const [budgetMsg, setBudgetMsg] = useState('')
  const [budgetBusy, setBudgetBusy] = useState(false)

  const [akahu, setAkahu] = useState({ app: '', user: '' })
  const [bankMsg, setBankMsg] = useState('')
  const [bankBusy, setBankBusy] = useState(false)
  const [bankCounts, setBankCounts] = useState<{ accounts: number; transactions: number } | null>(null)

  const [ai, setAi] = useState({
    provider: 'deepseek',
    key: '',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    reasoningModel: 'deepseek-reasoner'
  })
  const [aiMsg, setAiMsg] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const [discord, setDiscord] = useState({ webhook: '' })
  const [discordMsg, setDiscordMsg] = useState('')
  const [discordBusy, setDiscordBusy] = useState(false)

  const [launchAtLogin, setLaunchAtLogin] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [done, setDone] = useState<{ bank: boolean; ai: boolean; alerts: boolean; budget: number; tx: number }>({
    bank: false,
    ai: false,
    alerts: false,
    budget: 0,
    tx: 0
  })

  const current = STEPS[step]

  const refreshPreview = async (): Promise<void> => {
    setCyclePreview(await window.api.getCurrentCycle())
  }

  useEffect(() => {
    const load = async (): Promise<void> => {
      const [all, m, login] = await Promise.all([
        window.api.getSettings(),
        window.api.getMaskedSettings(),
        window.api.getLaunchAtLogin()
      ])
      setMasked(m)
      setCycle({
        frequency: all.INCOME_CYCLE_FREQUENCY || 'monthly',
        day: all.INCOME_CYCLE_DAY || '15',
        weekend: all.INCOME_CYCLE_WEEKEND || 'previous',
        anchor: all.INCOME_CYCLE_ANCHOR || ''
      })
      setAi({
        provider: m.AI_PROVIDER || 'deepseek',
        key: '',
        model: m.AI_MODEL || 'deepseek-chat',
        baseUrl: m.AI_BASE_URL || 'https://api.deepseek.com',
        reasoningModel: m.AI_REASONING_MODEL || 'deepseek-reasoner'
      })
      setLaunchAtLogin(login || all.LAUNCH_AT_LOGIN === '1')
      const resume = Number(all.ONBOARDING_STEP || '0')
      if (Number.isFinite(resume) && resume > 0 && resume < STEPS.length) setStep(resume)
      const [cats, bank] = await Promise.all([window.api.listCategories(), window.api.getBankStatus()])
      setDone((d) => ({ ...d, budget: cats.length, tx: bank.transactions, bank: bank.transactions > 0 }))
      await refreshPreview()
    }
    void load()
  }, [])

  const go = async (next: number): Promise<void> => {
    setStep(next)
    await window.api.setSetting('ONBOARDING_STEP', String(next))
  }

  const saveCycle = async (c = cycle): Promise<void> => {
    await window.api.setSetting('INCOME_CYCLE_FREQUENCY', c.frequency)
    await window.api.setSetting('INCOME_CYCLE_DAY', c.day || '15')
    await window.api.setSetting('INCOME_CYCLE_WEEKEND', c.weekend)
    await window.api.setSetting('INCOME_CYCLE_ANCHOR', c.frequency === 'monthly' ? '' : c.anchor)
    await window.api.setSetting('BUDGET_CHECK_DAY', c.day || '15')
    await refreshPreview()
  }

  // Changing a field persists immediately so the "current cycle" preview always
  // describes the dates the user is looking at.
  const changeCycle = async (patch: Partial<typeof cycle>): Promise<void> => {
    const next = { ...cycle, ...patch }
    setCycle(next)
    await saveCycle(next)
  }

  const runBudgetImport = async (): Promise<void> => {
    setBudgetBusy(true)
    setBudgetMsg('')
    try {
      const r = await window.api.importBudgetCsv()
      if (r.canceled) return
      const imported = r.imported ?? 0
      setBudgetMsg(
        imported > 0
          ? `Imported ${imported} budget line${imported === 1 ? '' : 's'}.`
          : 'No budget rows found in that file. Check the columns are category, amount.'
      )
      if (imported > 0) setDone((d) => ({ ...d, budget: d.budget + imported }))
    } catch (e) {
      setBudgetMsg(`Import failed: ${(e as Error).message}`)
    } finally {
      setBudgetBusy(false)
    }
  }

  const saveBank = async (): Promise<void> => {
    if (akahu.app.trim()) await window.api.setSetting('AKAHU_APP_TOKEN', akahu.app.trim())
    if (akahu.user.trim()) await window.api.setSetting('AKAHU_USER_TOKEN', akahu.user.trim())
  }

  const testBank = async (): Promise<void> => {
    setBankBusy(true)
    setBankMsg('')
    try {
      await saveBank()
      const r = await window.api.syncBank()
      setBankCounts({ accounts: r.accounts, transactions: r.transactions })
      setBankMsg(`Connected - ${r.accounts} accounts and ${r.transactions} transactions loaded.`)
      setDone((d) => ({ ...d, bank: true, tx: r.transactions }))
    } catch (e) {
      setBankMsg(`Could not connect: ${(e as Error).message}`)
    } finally {
      setBankBusy(false)
    }
  }

  const importStatement = async (): Promise<void> => {
    setBankBusy(true)
    setBankMsg('')
    try {
      const r = await window.api.importTransactionsCsv(accountName || undefined)
      if (r.canceled) return
      const imported = r.imported ?? 0
      setBankMsg(
        imported > 0
          ? `Imported ${imported} transactions (${r.dateFrom} to ${r.dateTo}). ${r.skipped ?? 0} rows skipped.`
          : 'No new transactions found - they may already be imported.'
      )
      if (imported > 0) setDone((d) => ({ ...d, bank: true, tx: (d.tx ?? 0) + imported }))
    } catch (e) {
      setBankMsg(`Import failed: ${(e as Error).message}`)
    } finally {
      setBankBusy(false)
    }
  }

  const saveAi = async (): Promise<void> => {
    await window.api.setSetting('AI_PROVIDER', ai.provider || 'deepseek')
    if (ai.key.trim()) await window.api.setSetting('AI_API_KEY', ai.key.trim())
    await window.api.setSetting('AI_MODEL', ai.model.trim())
    await window.api.setSetting('AI_BASE_URL', ai.baseUrl.trim())
    await window.api.setSetting(
      'AI_REASONING_MODEL',
      ai.reasoningModel.trim() || (ai.provider === 'deepseek' ? 'deepseek-reasoner' : ai.model.trim())
    )
  }

  const testAi = async (): Promise<void> => {
    setAiBusy(true)
    setAiMsg('')
    try {
      await saveAi()
      const r = await window.api.testAi()
      setAiMsg(r.ok ? `OK - ${r.message}` : `Failed - ${r.message}`)
      if (r.ok) setDone((d) => ({ ...d, ai: true }))
    } finally {
      setAiBusy(false)
    }
  }

  const testDiscord = async (): Promise<void> => {
    setDiscordBusy(true)
    setDiscordMsg('')
    try {
      if (discord.webhook.trim()) {
        await window.api.setSetting('DISCORD_WEBHOOK_URL', discord.webhook.trim())
      }
      const r = await window.api.testDiscord()
      setDiscordMsg(r.ok ? `OK - ${r.message}` : `Failed - ${r.message}`)
      if (r.ok) setDone((d) => ({ ...d, alerts: true }))
    } finally {
      setDiscordBusy(false)
    }
  }

  const finish = async (skipped = false): Promise<void> => {
    setFinishing(true)
    try {
      if (!skipped) {
        await saveCycle()
        await saveBank()
        await saveAi()
        if (discord.webhook.trim()) await window.api.setSetting('DISCORD_WEBHOOK_URL', discord.webhook.trim())
        await window.api.setLaunchAtLogin(launchAtLogin)
      }
      await window.api.setSetting('ONBOARDING_COMPLETED', '1')
      await window.api.setSetting('ONBOARDING_STEP', '')
      await window.api.setSetting('ONBOARDING_SKIPPED', skipped ? '1' : '0')
      onDone()
    } finally {
      setFinishing(false)
    }
  }

  const skipAll = async (): Promise<void> => {
    await window.api.setSetting('ONBOARDING_STEP', '')
    await finish(true)
  }

  const next = async (): Promise<void> => {
    if (current.id === 'cycle') await saveCycle()
    if (current.id === 'bank') await saveBank()
    if (current.id === 'ai') await saveAi()
    if (current.id === 'finish') return finish()
    await go(Math.min(step + 1, STEPS.length - 1))
  }

  const back = async (): Promise<void> => {
    if (step === 0) return
    await go(step - 1)
  }

  const summaryRows = [
    { label: 'Pay cycle', value: `${cycle.frequency}, day ${cycle.day}`, on: true },
    {
      label: 'Budget',
      value: done.budget > 0 ? `${done.budget} lines` : 'add lines in Budgets',
      on: done.budget > 0
    },
    {
      label: 'Bank data',
      value: done.bank ? `${done.tx} transactions` : 'skipped',
      on: done.bank
    },
    { label: 'AI advisor', value: done.ai ? 'connected' : 'skipped, add a key in Settings', on: done.ai },
    { label: 'Discord alerts', value: done.alerts ? 'test message sent' : 'skipped', on: done.alerts }
  ]

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass flex w-full max-w-5xl overflow-hidden rounded-3xl">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-white/[0.12] bg-white/[0.03] p-6 sm:flex">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9" />
            <div>
              <p className="text-sm font-semibold text-slate-100">FinanceBot</p>
              <p className="text-[11px] text-slate-500">Local, private, NZ</p>
            </div>
          </div>

          <ol className="mt-8 space-y-1">
            {STEPS.map((s, i) => {
              const active = i === step
              const complete = i < step
              return (
                <li key={s.id}>
                  <div
                    className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm ${
                      active ? 'bg-accent/[0.1] text-slate-100' : complete ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                        complete
                          ? 'bg-accent text-surface-950'
                          : active
                            ? 'border border-accent/60 text-accent'
                            : 'border border-white/[0.16] text-slate-500'
                      }`}
                    >
                      {complete ? '✓' : i + 1}
                    </span>
                    {s.label}
                    {s.id !== 'welcome' && s.id !== 'cycle' && s.id !== 'budget' && s.id !== 'finish' && (
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-600">optional</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>

          <div className="mt-auto space-y-2 pt-8">
            <p className="text-[11px] leading-relaxed text-slate-500">
              Everything here can be changed later in Settings. No account is created and no data leaves this PC
              unless you connect a service.
            </p>
            <button
              onClick={skipAll}
              className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
            >
              Skip setup for now
            </button>
          </div>
        </aside>

        <section className="flex min-h-[600px] flex-1 flex-col p-8">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
              Step {step + 1} of {STEPS.length}
            </p>
            <div className="h-1 w-28 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          <h1 className="mt-4 text-2xl font-semibold text-slate-50">{current.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{current.blurb}</p>

          <div className="mt-6 flex-1">
            {current.id === 'welcome' && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ['Budgets', 'Pay-cycle budgets with live spend'],
                    ['Notifications', 'Price rises and pacing checks'],
                    ['Forecast', 'Balance projection to payday']
                  ].map(([title, text]) => (
                    <div key={title} className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-3">
                      <p className="text-sm font-medium text-slate-200">{title}</p>
                      <p className="mt-1 text-xs text-slate-500">{text}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-4 text-sm text-slate-400">
                  <p className="font-medium text-slate-200">What this wizard does</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    <li>- Sets your pay cycle (the basis for every calculation)</li>
                    <li>- Imports a budget, if you have one</li>
                    <li>- Optionally connects Akahu, an AI provider and Discord</li>
                  </ul>
                </div>
              </div>
            )}

            {current.id === 'cycle' && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={labelCls}>
                    Pay frequency
                    <select
                      value={cycle.frequency}
                      onChange={(e) => void changeCycle({ frequency: e.target.value })}
                      className={`${fieldCls} mt-1`}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="fortnightly">Fortnightly</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </label>

                  {cycle.frequency === 'monthly' ? (
                    <label className={labelCls}>
                      Pay day of month
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={cycle.day}
                        onChange={(e) => void changeCycle({ day: e.target.value })}
                        className={`${fieldCls} mt-1`}
                      />
                    </label>
                  ) : (
                    <label className={labelCls}>
                      A recent payday (anchor)
                      <input
                        type="date"
                        value={cycle.anchor}
                        onChange={(e) => void changeCycle({ anchor: e.target.value })}
                        className={`${fieldCls} mt-1`}
                      />
                    </label>
                  )}

                  {cycle.frequency === 'monthly' && (
                    <label className={labelCls}>
                      If payday falls on a weekend
                      <select
                        value={cycle.weekend}
                        onChange={(e) => void changeCycle({ weekend: e.target.value })}
                        className={`${fieldCls} mt-1`}
                      >
                        <option value="previous">Pay on the Friday before</option>
                        <option value="next">Pay on the Monday after</option>
                        <option value="none">Use the calendar date</option>
                      </select>
                    </label>
                  )}
                </div>

                <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Current cycle</p>
                  <p className="mt-1 text-sm text-slate-200">
                    {cyclePreview ? (
                      <>
                        {shortDate(cyclePreview.start)} to{' '}
                        {shortDate(
                          new Date(Date.parse(cyclePreview.end) - 86_400_000).toISOString().slice(0, 10)
                        )}{' '}
                        <span className="text-slate-500">
                          (
                          {Math.round(
                            (Date.parse(cyclePreview.end) - Date.parse(cyclePreview.start)) / 86_400_000
                          )}{' '}
                          days)
                        </span>
                      </>
                    ) : (
                      'Calculating...'
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    The cycle starts on payday and runs to the day before the next payday.
                  </p>
                </div>
              </div>
            )}

            {current.id === 'budget' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-4">
                  <p className="text-sm font-medium text-slate-200">CSV format</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Two columns - category and monthly amount. A header row is optional.
                    <br />
                    <span className="text-slate-300">Groceries, 800</span>
                    <br />
                    <span className="text-slate-300">Fuel, 120</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={runBudgetImport} disabled={budgetBusy}>
                    {budgetBusy ? 'Importing...' : 'Import budget CSV'}
                  </Button>
                  <span className="text-xs text-slate-500">or continue and add lines later in Budgets.</span>
                </div>
                {budgetMsg && (
                  <p className={`text-sm ${budgetMsg.startsWith('Import failed') ? 'text-danger' : 'text-accent'}`}>
                    {budgetMsg}
                  </p>
                )}
              </div>
            )}

            {current.id === 'bank' && (
              <div className="space-y-5">
                <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-200">Akahu (NZ open banking)</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Each person needs their own app token + user token from{' '}
                      <span className="text-accent">my.akahu.nz</span>. Tokens cannot be shared between accounts.
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={labelCls}>
                      App token
                      <input
                        value={akahu.app}
                        onChange={(e) => setAkahu({ ...akahu, app: e.target.value })}
                        placeholder={masked.AKAHU_APP_TOKEN || 'app_token_...'}
                        className={`${fieldCls} mt-1`}
                      />
                    </label>
                    <label className={labelCls}>
                      User token
                      <input
                        value={akahu.user}
                        onChange={(e) => setAkahu({ ...akahu, user: e.target.value })}
                        placeholder={masked.AKAHU_USER_TOKEN || 'user_token_...'}
                        className={`${fieldCls} mt-1`}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button onClick={testBank} disabled={bankBusy}>
                      {bankBusy ? 'Connecting...' : 'Save & sync bank'}
                    </Button>
                    {bankCounts && (
                      <span className="text-xs text-slate-400">
                        {bankCounts.accounts} accounts, {bankCounts.transactions} transactions
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-4">
                  <p className="text-sm font-medium text-slate-200">No Akahu? Import a statement CSV</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Export transactions from your bank as CSV (date, description, amount) and import them here.
                    Re-importing the same file is safe - duplicates are ignored.
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className={`${labelCls} min-w-[220px] flex-1`}>
                      Account name (optional)
                      <input
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        placeholder="e.g. Everyday account"
                        className={`${fieldCls} mt-1`}
                      />
                    </label>
                    <Button variant="secondary" onClick={importStatement} disabled={bankBusy}>
                      Import statement CSV
                    </Button>
                  </div>
                </div>

                {bankMsg && (
                  <p className={`text-sm ${bankMsg.startsWith('Could not') || bankMsg.startsWith('Import failed') ? 'text-danger' : 'text-accent'}`}>
                    {bankMsg}
                  </p>
                )}
              </div>
            )}

            {current.id === 'ai' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-4">
                  <p className="text-xs leading-relaxed text-slate-500">
                    The advisor sends a read-only financial snapshot (budgets, balances, recent transactions) to{' '}
                    {aiProviderPreset(ai.provider).label} when you ask a question. Without a key the chat stays off; the
                    rest of the app works normally.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={labelCls}>
                      Provider
                      <select
                        value={ai.provider}
                        onChange={(e) => {
                          const preset = aiProviderPreset(e.target.value)
                          setAi({
                            ...ai,
                            provider: preset.id,
                            model: preset.models[0]?.id ?? '',
                            baseUrl: preset.baseUrl,
                            reasoningModel:
                              preset.id === 'deepseek' ? 'deepseek-reasoner' : (preset.models[0]?.id ?? '')
                          })
                          setAiMsg('')
                        }}
                        className={`${fieldCls} mt-1`}
                      >
                        {AI_PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelCls}>
                      {aiProviderPreset(ai.provider).label} API key
                      <input
                        type="password"
                        value={ai.key}
                        onChange={(e) => setAi({ ...ai, key: e.target.value })}
                        placeholder={
                          masked.AI_API_KEY && masked.AI_PROVIDER === ai.provider
                            ? 'Saved — leave blank to keep'
                            : aiProviderPreset(ai.provider).keyPlaceholder
                        }
                        className={`${fieldCls} mt-1`}
                        autoComplete="off"
                      />
                    </label>
                    <label className={labelCls}>
                      Model
                      <input
                        list="onboarding-ai-models"
                        value={ai.model}
                        onChange={(e) => setAi({ ...ai, model: e.target.value })}
                        placeholder={aiProviderPreset(ai.provider).models[0]?.id || 'model id'}
                        className={`${fieldCls} mt-1`}
                      />
                      <datalist id="onboarding-ai-models">
                        {aiProviderPreset(ai.provider).models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </datalist>
                    </label>
                    <label className={labelCls}>
                      Base URL
                      <input
                        value={ai.baseUrl}
                        onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                        placeholder={aiProviderPreset(ai.provider).baseUrl || 'https://…/v1'}
                        className={`${fieldCls} mt-1`}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={testAi}
                      disabled={
                        aiBusy || (!ai.key.trim() && !(masked.AI_API_KEY && masked.AI_PROVIDER === ai.provider))
                      }
                    >
                      {aiBusy ? 'Testing...' : 'Save & test key'}
                    </Button>
                    <span className="text-xs text-slate-500">
                      Create a key at <span className="text-accent">{aiProviderPreset(ai.provider).keyHint}</span>.
                    </span>
                  </div>
                </div>
                {aiMsg && (
                  <p className={`text-sm ${aiMsg.startsWith('Failed') ? 'text-danger' : 'text-accent'}`}>{aiMsg}</p>
                )}
              </div>
            )}

            {current.id === 'alerts' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-4">
                  <label className={labelCls}>
                    Discord webhook URL
                    <input
                      value={discord.webhook}
                      onChange={(e) => setDiscord({ ...discord, webhook: e.target.value })}
                      placeholder={masked.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/...'}
                      className={`${fieldCls} mt-1`}
                    />
                  </label>
                  <p className="mt-2 text-xs text-slate-500">
                    In Discord: Server settings, Integrations, Webhooks, New webhook, Copy URL. Alerts only fire while
                    FinanceBot is running.
                  </p>
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      onClick={testDiscord}
                      disabled={discordBusy || !discord.webhook.trim()}
                    >
                      {discordBusy ? 'Sending...' : 'Send test message'}
                    </Button>
                  </div>
                </div>
                {discordMsg && (
                  <p className={`text-sm ${discordMsg.startsWith('Failed') ? 'text-danger' : 'text-accent'}`}>
                    {discordMsg}
                  </p>
                )}
              </div>
            )}

            {current.id === 'finish' && (
              <div className="space-y-4">
                <div className="divide-y divide-white/[0.08] rounded-xl border border-white/[0.12] bg-white/[0.04]">
                  {summaryRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <span className="text-sm text-slate-200">{row.label}</span>
                      <span className={`text-xs ${row.on ? 'text-accent' : 'text-slate-500'}`}>{row.value}</span>
                    </div>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={launchAtLogin}
                    onChange={(e) => setLaunchAtLogin(e.target.checked)}
                    className="h-4 w-4 accent-accent"
                  />
                  Start FinanceBot when I sign in to Windows
                </label>
                <p className="text-xs text-slate-500">
                  Recommended: background checks (alerts, reminders, sync) only run while the app is open.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.1] pt-4">
            {current.id === 'finish' ? (
              <span />
            ) : step === 0 ? (
              <button
                onClick={skipAll}
                className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              >
                Skip setup for now
              </button>
            ) : (
              <button
                onClick={async () => go(step + 1)}
                className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              >
                Skip this step
              </button>
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={back} disabled={step === 0 || finishing}>
                Back
              </Button>
              <Button onClick={next} disabled={finishing}>
                {current.id === 'finish' ? (finishing ? 'Saving...' : 'Open FinanceBot') : 'Continue'}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
