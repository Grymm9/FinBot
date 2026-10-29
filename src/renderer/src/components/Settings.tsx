import { useEffect, useState } from 'react'
import type {
  AlertResult,
  BackupInfo,
  EmailScanResult,
  EvalReport,
  ServiceHealth,
  Settings as SettingsMap,
  UpdateStatus
} from '@shared/types'
import { Button, Card, SectionHeader } from './ui'
import { getStoredTheme, setTheme, THEMES, type ThemeId } from '../lib/theme'

export default function Settings({
  onChanged,
  onRestartSetup
}: {
  onChanged: () => void
  onRestartSetup?: () => void
}): JSX.Element {
  const [masked, setMasked] = useState<SettingsMap | null>(null)
  const [secrets, setSecrets] = useState({ akahuApp: '', akahuUser: '', deepseekKey: '' })
  const [fields, setFields] = useState({
    baseUrl: '',
    model: '',
    webhook: '',
    incomeDay: '',
    checkDay: '',
    ratio: '',
    botToken: '',
    channelId: '',
    emailAddress: '',
    emailPassword: '',
    emailHost: '',
    emailPort: '',
    emailLabel: '',
    autoSyncHours: '',
    useThreads: '1',
    updateFeed: '',
    updateFeedUrl: '',
    autoUpdate: '1',
    autoUpdateDownload: '1'
  })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [alertResult, setAlertResult] = useState<AlertResult | null>(null)
  const [emailResult, setEmailResult] = useState<EmailScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupNotice, setBackupNotice] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [health, setHealth] = useState<ServiceHealth[]>([])
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null)
  const [evalBusy, setEvalBusy] = useState(false)
  const [theme, setThemeState] = useState<ThemeId>(getStoredTheme)

  const loadBackups = async (): Promise<void> => setBackups(await window.api.listBackups())

  useEffect(() => {
    const load = async (): Promise<void> => {
      const m = await window.api.getMaskedSettings()
      setMasked(m)
      setFields({
        baseUrl: m.DEEPSEEK_BASE_URL,
        model: m.DEEPSEEK_MODEL,
        webhook: m.DISCORD_WEBHOOK_URL,
        incomeDay: m.INCOME_CYCLE_DAY,
        checkDay: m.BUDGET_CHECK_DAY,
        ratio: m.ALERT_SPEND_RATIO,
        botToken: m.DISCORD_BOT_TOKEN,
        channelId: m.DISCORD_CHANNEL_ID,
        emailAddress: m.EMAIL_ADDRESS,
        emailPassword: m.EMAIL_PASSWORD,
        emailHost: m.EMAIL_HOST,
        emailPort: m.EMAIL_PORT,
        emailLabel: m.EMAIL_LABEL,
        autoSyncHours: m.AUTO_SYNC_HOURS ?? '4',
        useThreads: m.DISCORD_USE_THREADS === '0' ? '0' : '1',
        updateFeed: m.UPDATE_FEED_PATH ?? '',
        updateFeedUrl: m.UPDATE_FEED_URL ?? '',
        autoUpdate: m.AUTO_UPDATE === '0' ? '0' : '1',
        autoUpdateDownload: m.AUTO_UPDATE_DOWNLOAD === '0' ? '0' : '1'
      })
    }
    void load()
    void loadBackups()
    void window.api.getUpdateStatus().then(setUpdateStatus)
    void window.api.getHealth().then(setHealth)
    void window.api.lastAiEval().then(setEvalReport)
    return window.api.onUpdateStatus(setUpdateStatus)
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    setNotice('')
    const sets: Array<[string, string]> = []
    if (secrets.akahuApp.trim()) sets.push(['AKAHU_APP_TOKEN', secrets.akahuApp.trim()])
    if (secrets.akahuUser.trim()) sets.push(['AKAHU_USER_TOKEN', secrets.akahuUser.trim()])
    if (secrets.deepseekKey.trim()) sets.push(['DEEPSEEK_API_KEY', secrets.deepseekKey.trim()])
    sets.push(['DEEPSEEK_BASE_URL', fields.baseUrl.trim() || 'https://api.deepseek.com'])
    sets.push(['DEEPSEEK_MODEL', fields.model.trim() || 'deepseek-chat'])
    sets.push(['DISCORD_WEBHOOK_URL', fields.webhook.trim()])
    sets.push(['DISCORD_BOT_TOKEN', fields.botToken.trim()])
    sets.push(['DISCORD_CHANNEL_ID', fields.channelId.trim()])
    sets.push(['EMAIL_ADDRESS', fields.emailAddress.trim()])
    sets.push(['EMAIL_PASSWORD', fields.emailPassword.trim()])
    sets.push(['EMAIL_HOST', fields.emailHost.trim() || 'imap.gmail.com'])
    sets.push(['EMAIL_PORT', fields.emailPort.trim() || '993'])
    sets.push(['EMAIL_LABEL', fields.emailLabel.trim() || 'important-finances'])
    sets.push(['INCOME_CYCLE_DAY', fields.incomeDay || '15'])
    sets.push(['BUDGET_CHECK_DAY', fields.checkDay || '15'])
    sets.push(['ALERT_SPEND_RATIO', fields.ratio || '0.8'])
    sets.push(['AUTO_SYNC_HOURS', fields.autoSyncHours.trim() || '4'])
    sets.push(['DISCORD_USE_THREADS', fields.useThreads === '0' ? '0' : '1'])
    sets.push(['UPDATE_FEED_PATH', fields.updateFeed.trim()])
    sets.push(['UPDATE_FEED_URL', fields.updateFeedUrl.trim()])
    sets.push(['AUTO_UPDATE', fields.autoUpdate === '0' ? '0' : '1'])
    sets.push(['AUTO_UPDATE_DOWNLOAD', fields.autoUpdateDownload === '0' ? '0' : '1'])

    for (const [k, v] of sets) await window.api.setSetting(k, v)
    setSecrets({ akahuApp: '', akahuUser: '', deepseekKey: '' })
    setNotice('Settings saved.')
    onChanged()
    setSaving(false)
  }

  const testDiscord = async (): Promise<void> => {
    const r = await window.api.testDiscord()
    setNotice(r.ok ? `✅ ${r.message}` : `❌ ${r.message}`)
  }

  const runCheck = async (): Promise<void> => {
    setAlertResult(await window.api.runBudgetCheck())
  }

  const checkReplies = async (): Promise<void> => {
    const r = await window.api.checkDiscordReplies()
    setNotice(r.error ? `❌ ${r.error}` : `✅ Mapped ${r.processed} and replied to ${r.replied} message${r.replied === 1 ? '' : 's'}.`)
  }

  const scanEmails = async (): Promise<void> => {
    setScanning(true)
    setEmailResult(null)
    for (const [k, v] of [
      ['EMAIL_ADDRESS', fields.emailAddress.trim()],
      ['EMAIL_PASSWORD', fields.emailPassword.trim()],
      ['EMAIL_HOST', fields.emailHost.trim() || 'imap.gmail.com'],
      ['EMAIL_PORT', fields.emailPort.trim() || '993'],
      ['EMAIL_LABEL', fields.emailLabel.trim() || 'important-finances']
    ]) {
      await window.api.setSetting(k, v)
    }
    setEmailResult(await window.api.scanEmails())
    setScanning(false)
  }

  const backupNow = async (): Promise<void> => {
    setBackupBusy(true)
    setBackupNotice('')
    try {
      const b = await window.api.createBackup()
      setBackupNotice(b ? `Backup created: ${b.fileName}` : 'Backup failed.')
      await loadBackups()
    } finally {
      setBackupBusy(false)
    }
  }

  const restore = async (fileName: string): Promise<void> => {
    if (!confirm(`Replace the live database with ${fileName}? FinanceBot will restart.`)) return
    const r = await window.api.restoreBackup(fileName)
    if (!r.ok) setBackupNotice(`❌ ${r.error ?? 'Restore failed.'}`)
  }

  const exportCsv = async (): Promise<void> => {
    const r = await window.api.exportTransactionsCsv()
    if (r.canceled) return
    setBackupNotice(r.error ? `❌ ${r.error}` : `Exported ${r.rows ?? 0} transactions to ${r.path}`)
  }

  const checkUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      setUpdateStatus(await window.api.checkForUpdate())
    } finally {
      setUpdateBusy(false)
    }
  }

  const installNow = async (): Promise<void> => {
    if (!confirm('Restart FinanceBot and install the downloaded update?')) return
    setUpdateStatus(await window.api.installUpdate())
  }

  const runEvals = async (): Promise<void> => {
    setEvalBusy(true)
    try {
      setEvalReport(await window.api.runAiEvals())
    } finally {
      setEvalBusy(false)
    }
  }

  const chooseTheme = (id: ThemeId): void => {
    setThemeState(id)
    setTheme(id)
    setNotice('Theme updated.')
  }

  const updateLabel = (s: UpdateStatus | null): string => {
    if (!s) return 'Not checked yet.'
    switch (s.state) {
      case 'disabled':
        return s.message ?? 'Updates are disabled.'
      case 'checking':
        return 'Checking…'
      case 'uptodate':
        return `Up to date (v${s.currentVersion}).`
      case 'available':
        return `v${s.availableVersion} available.`
      case 'downloading':
        return `Downloading v${s.availableVersion}… ${s.progress ?? 0}%`
      case 'ready':
        return `v${s.availableVersion} ready to install. ${s.message ?? ''}`
      case 'error':
        return `Update failed: ${s.message ?? 'unknown error'}`
      default:
        return `Version ${s.currentVersion}.`
    }
  }

  const fmtBytes = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`

  const inputCls =
    'mt-1 w-full rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none'
  const labelCls = 'block text-xs font-medium text-slate-400'

  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" subtitle="Appearance, API keys, alert tuning and integrations." />

      <Card className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Appearance</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Pick a palette — it applies immediately and is remembered on this machine.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEMES.map((t) => {
            const active = theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => chooseTheme(t.id)}
                aria-pressed={active}
                className={`rounded-2xl border p-3 text-left transition-all ${
                  active
                    ? 'border-accent/60 bg-accent/[0.08] ring-2 ring-accent/25'
                    : 'border-white/[0.12] bg-white/[0.03] hover:border-white/[0.24] hover:bg-white/[0.06]'
                }`}
              >
                <span
                  className="relative flex h-20 w-full overflow-hidden rounded-xl border"
                  style={{ background: t.preview.background, borderColor: t.preview.border }}
                >
                  <span
                    className="absolute left-3 top-4 flex h-[62px] w-[52%] flex-col justify-end gap-1 rounded-lg border p-2"
                    style={{ background: t.preview.glass, borderColor: t.preview.border }}
                  >
                    <span className="h-1.5 w-8 rounded-full" style={{ background: t.preview.accent }} />
                    <span
                      className="h-1 w-full rounded-full opacity-60"
                      style={{ background: t.preview.text }}
                    />
                    <span
                      className="h-1 w-3/4 rounded-full opacity-40"
                      style={{ background: t.preview.text }}
                    />
                  </span>
                  <span
                    className="absolute right-3 top-3 h-7 w-7 rounded-full"
                    style={{ background: t.preview.accent, boxShadow: `0 0 18px ${t.preview.accent}` }}
                  />
                  <span
                    className="absolute bottom-3 right-3 text-[13px] font-semibold"
                    style={{ color: t.preview.text }}
                  >
                    Aa
                  </span>
                </span>
                <span className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-100">{t.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      active ? 'bg-accent/15 text-accent' : 'text-slate-500'
                    }`}
                  >
                    {active ? 'Active' : 'Select'}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-slate-500">{t.description}</span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Setup assistant</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Re-run the guided setup to connect a bank, add an AI key or change your pay cycle. Every step can be
              skipped.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              await window.api.setSetting('ONBOARDING_COMPLETED', '0')
              await window.api.setSetting('SETUP_CHECKLIST_HIDDEN', '')
              onRestartSetup?.()
            }}
          >
            Run setup again
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Akahu (NZ Open Finance)</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelCls}>
            App token
            <input
              value={secrets.akahuApp}
              onChange={(e) => setSecrets({ ...secrets, akahuApp: e.target.value })}
              placeholder={masked?.AKAHU_APP_TOKEN || 'app_token_…'}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            User token
            <input
              value={secrets.akahuUser}
              onChange={(e) => setSecrets({ ...secrets, akahuUser: e.target.value })}
              placeholder={masked?.AKAHU_USER_TOKEN || 'user_token_…'}
              className={inputCls}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Leave a token field blank to keep its existing value. Get tokens at{' '}
          <span className="text-accent">my.akahu.nz</span>.
        </p>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">DeepSeek AI</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelCls}>
            API key
            <input
              value={secrets.deepseekKey}
              onChange={(e) => setSecrets({ ...secrets, deepseekKey: e.target.value })}
              placeholder={masked?.DEEPSEEK_API_KEY || 'sk-…'}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Model
            <select
              value={fields.model}
              onChange={(e) => setFields({ ...fields, model: e.target.value })}
              className={inputCls}
            >
              <option value="deepseek-chat">deepseek-chat (fast)</option>
              <option value="deepseek-reasoner">deepseek-reasoner (deep reasoning)</option>
            </select>
          </label>
          <label className={`${labelCls} sm:col-span-2`}>
            Base URL
            <input
              value={fields.baseUrl}
              onChange={(e) => setFields({ ...fields, baseUrl: e.target.value })}
              className={inputCls}
            />
          </label>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Discord alerts</h3>
        <label className={labelCls}>
          Webhook URL
          <input
            value={fields.webhook}
            onChange={(e) => setFields({ ...fields, webhook: e.target.value })}
            placeholder="https://discord.com/api/webhooks/…"
            className={inputCls}
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelCls}>
            Bot token (for two-way replies)
            <input
              value={fields.botToken}
              onChange={(e) => setFields({ ...fields, botToken: e.target.value })}
              placeholder="Bot token…"
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Channel ID (to listen for replies)
            <input
              value={fields.channelId}
              onChange={(e) => setFields({ ...fields, channelId: e.target.value })}
              placeholder="1234567890…"
              className={inputCls}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className={labelCls}>
            Income cycle day
            <input
              type="number"
              min={1}
              max={31}
              value={fields.incomeDay}
              onChange={(e) => setFields({ ...fields, incomeDay: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Budget check day
            <input
              type="number"
              min={1}
              max={31}
              value={fields.checkDay}
              onChange={(e) => setFields({ ...fields, checkDay: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Alert spend ratio
            <input
              type="number"
              min={0.1}
              max={1}
              step="0.05"
              value={fields.ratio}
              onChange={(e) => setFields({ ...fields, ratio: e.target.value })}
              className={inputCls}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className={labelCls}>
            Auto-sync every (hours)
            <input
              type="number"
              min={0}
              max={24}
              value={fields.autoSyncHours}
              onChange={(e) => setFields({ ...fields, autoSyncHours: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className={`${labelCls} flex items-center gap-2 sm:col-span-2`}>
            <input
              type="checkbox"
              checked={fields.useThreads !== '0'}
              onChange={(e) => setFields({ ...fields, useThreads: e.target.checked ? '1' : '0' })}
              className="h-4 w-4 accent-accent"
            />
            Reply to Discord messages in threads
          </label>
        </div>
        <p className="text-xs text-slate-500">
          The bank syncs on launch and every {fields.autoSyncHours || '4'} hours (0 turns the periodic sync off). Threads
          need a bot token and channel ID.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" onClick={testDiscord}>
            Test Discord
          </Button>
          <Button variant="secondary" onClick={checkReplies}>
            Check Discord replies
          </Button>
          <Button variant="secondary" onClick={runCheck}>
            Run budget check
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Email scanning</h3>
        <p className="text-xs text-slate-500">
          Scan the "important-finances" Gmail label for insurance and bank notifications (IMAP). For Gmail, generate an
          App Password at myaccount.google.com.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelCls}>
            Email address
            <input
              value={fields.emailAddress}
              onChange={(e) => setFields({ ...fields, emailAddress: e.target.value })}
              placeholder="you@gmail.com"
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            App password
            <input
              type="password"
              value={fields.emailPassword}
              onChange={(e) => setFields({ ...fields, emailPassword: e.target.value })}
              placeholder="App password"
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            IMAP host
            <input
              value={fields.emailHost}
              onChange={(e) => setFields({ ...fields, emailHost: e.target.value })}
              placeholder="imap.gmail.com"
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            IMAP port
            <input
              value={fields.emailPort}
              onChange={(e) => setFields({ ...fields, emailPort: e.target.value })}
              placeholder="993"
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Gmail label
            <input
              value={fields.emailLabel}
              onChange={(e) => setFields({ ...fields, emailLabel: e.target.value })}
              placeholder="Important Finances"
              className={inputCls}
            />
          </label>
        </div>
        <Button variant="secondary" onClick={scanEmails} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan emails'}
        </Button>

        {emailResult?.error && <p className="text-sm text-danger">❌ {emailResult.error}</p>}
        {emailResult && !emailResult.error && (
          <div className="space-y-2">
            <p className="text-sm text-slate-300">
              Found {emailResult.matches.length} relevant {emailResult.matches.length === 1 ? 'email' : 'emails'}:
            </p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {emailResult.matches.map((m, i) => (
                <li key={i} className="rounded-md border border-white/[0.1] bg-white/[0.05] p-2">
                  <p className="text-sm text-slate-200">{m.subject || '(no subject)'}</p>
                  <p className="text-xs text-slate-500">
                    {m.from} · {m.date.slice(0, 10)} · {m.keywords.join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">App updates</h3>
        <p className="text-xs text-slate-500">
          By default updates come from the GitHub release feed baked into the app. The installer is SHA-512 verified and
          never installed without your click. A folder overrides the URL (useful for local builds); changes apply on
          restart.
        </p>
        <label className={labelCls}>
          Update feed URL
          <input
            value={fields.updateFeedUrl}
            onChange={(e) => setFields({ ...fields, updateFeedUrl: e.target.value })}
            placeholder="https://github.com/Grymm9/FinBot/releases/latest/download"
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          Update feed folder (overrides the URL)
          <input
            value={fields.updateFeed}
            onChange={(e) => setFields({ ...fields, updateFeed: e.target.value })}
            placeholder="C:\\Users\\you\\FinanceBotFeed"
            className={inputCls}
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={fields.autoUpdate !== '0'}
              onChange={(e) => setFields({ ...fields, autoUpdate: e.target.checked ? '1' : '0' })}
              className="h-4 w-4 accent-accent"
            />
            Check automatically
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={fields.autoUpdateDownload !== '0'}
              onChange={(e) => setFields({ ...fields, autoUpdateDownload: e.target.checked ? '1' : '0' })}
              className="h-4 w-4 accent-accent"
            />
            Download in the background
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={checkUpdate} disabled={updateBusy}>
            {updateBusy ? 'Checking…' : 'Check for updates'}
          </Button>
          {updateStatus?.state === 'ready' && (
            <Button onClick={installNow}>Restart &amp; install</Button>
          )}
        </div>
        <p className={`text-xs ${updateStatus?.state === 'error' ? 'text-danger' : 'text-slate-400'}`}>
          {updateLabel(updateStatus)}
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">AI self-test</h3>
          <Button variant="secondary" onClick={runEvals} disabled={evalBusy}>
            {evalBusy ? 'Running…' : 'Run AI self-test'}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Eight read-only prompts through the real chat pipeline, checked against your live data (budget totals, cycle
          dates, forecast, subscriptions, tool use, and a no-invention test). Costs a few cents per run.
        </p>
        {evalReport && (
          <div className="space-y-1.5">
            <p className={`text-sm ${evalReport.passed === evalReport.total ? 'text-accent' : 'text-warn'}`}>
              {evalReport.passed}/{evalReport.total} passed · {new Date(evalReport.ranAt).toLocaleString('en-NZ')}
            </p>
            <ul className="space-y-1">
              {evalReport.cases.map((c) => (
                <li key={c.id} className="flex gap-2 text-xs">
                  <span className={c.ok ? 'text-accent' : 'text-danger'}>{c.ok ? '✓' : '✗'}</span>
                  <span className="min-w-0">
                    <span className="text-slate-300">{c.id}</span>
                    <span className="text-slate-600"> · {c.ms}ms</span>
                    <span className={`block ${c.ok ? 'text-slate-500' : 'text-danger'}`}>{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">Service health</h3>
          <Button variant="secondary" onClick={() => void window.api.getHealth().then(setHealth)}>
            Refresh
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Background schedulers record every run here. Three consecutive failures also send a Discord message.
        </p>
        <ul className="divide-y divide-white/[0.08]">
          {health.map((h) => (
            <li key={h.service} className="py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-slate-200">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      !h.configured
                        ? 'bg-slate-600'
                        : h.status === 'ok'
                          ? 'bg-accent'
                          : h.status === 'warn'
                            ? 'bg-warn'
                            : h.status === 'fail'
                              ? 'bg-danger'
                              : 'bg-slate-600'
                    }`}
                  />
                  {h.label}
                  {!h.configured && (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                      not configured
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-slate-500">
                  {!h.configured
                    ? 'optional — set it up in Settings or the setup assistant'
                    : h.lastOk
                      ? `OK ${new Date(h.lastOk).toLocaleString('en-NZ')}`
                      : 'no successful run yet'}
                </span>
              </div>
              {h.lastError && (
                <p className="mt-0.5 pl-4 text-[11px] text-danger">
                  {h.failures > 0 ? `${h.failures}× — ` : ''}
                  {h.lastError}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Data &amp; backups</h3>
        <p className="text-xs text-slate-500">
          A snapshot of the database is taken automatically each day (the last 7 are kept). Restoring replaces the
          current data and restarts FinanceBot.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={backupNow} disabled={backupBusy}>
            {backupBusy ? 'Backing up…' : 'Back up now'}
          </Button>
          <Button variant="secondary" onClick={exportCsv}>
            Export transactions CSV
          </Button>
        </div>
        {backupNotice && <p className="text-xs text-accent">{backupNotice}</p>}
        {backups.length === 0 ? (
          <p className="text-xs text-slate-500">No backups yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.08]">
            {backups.map((b) => (
              <li key={b.fileName} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{b.fileName}</p>
                  <p className="text-[11px] text-slate-500">
                    {new Date(b.createdAt).toLocaleString('en-NZ')} · {fmtBytes(b.sizeBytes)}
                  </p>
                </div>
                <button
                  onClick={() => void restore(b.fileName)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-danger/15 hover:text-danger"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {alertResult && (
        <Card className="border-white/[0.2]">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Budget check result</h3>
          <p className="whitespace-pre-wrap text-sm text-slate-300">{alertResult.message}</p>
          <p className="mt-2 text-xs text-slate-500">
            Checked day {alertResult.checkedDay} · pre-payday check day {alertResult.budgetCheckDay} ·{' '}
            {alertResult.webhookConfigured ? 'webhook configured' : 'no webhook configured'}
          </p>
        </Card>
      )}

      {notice && <p className="text-sm text-accent">{notice}</p>}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </div>
  )
}
