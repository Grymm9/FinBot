import { useState } from 'react'
import type { BankStatus, Settings } from '@shared/types'

/**
 * Small "finish setting this up" card for people who skipped steps in the
 * wizard. Disappears once the optional integrations are configured (or when
 * dismissed), and never blocks the dashboard.
 */
export default function SetupChecklist({
  settings,
  bankStatus,
  onOpenSetup
}: {
  settings: Settings
  bankStatus: BankStatus | null
  onOpenSetup: () => void
}): JSX.Element | null {
  const [hidden, setHidden] = useState(false)

  const hasBank = !!settings.AKAHU_APP_TOKEN && !!settings.AKAHU_USER_TOKEN
  const hasData = (bankStatus?.transactions ?? 0) > 0
  const hasAi = !!settings.DEEPSEEK_API_KEY
  const hasAlerts = !!settings.DISCORD_WEBHOOK_URL

  const items = [
    !hasBank && !hasData && {
      label: 'No transactions yet',
      detail: 'Connect Akahu, or import a bank statement CSV.',
      key: 'bank'
    },
    !hasAi && { label: 'AI advisor is off', detail: 'Add a DeepSeek API key to enable chat.', key: 'ai' },
    !hasAlerts && { label: 'Alerts are off', detail: 'Add a Discord webhook for budget warnings.', key: 'alerts' }
  ].filter(Boolean) as Array<{ label: string; detail: string; key: string }>

  if (hidden || items.length === 0 || settings.SETUP_CHECKLIST_HIDDEN === '1') return null

  const dismiss = async (): Promise<void> => {
    setHidden(true)
    await window.api.setSetting('SETUP_CHECKLIST_HIDDEN', '1')
  }

  return (
    <div className="mb-5 rounded-2xl border border-accent/25 bg-accent/[0.05] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">Finish setting up</p>
          <p className="mt-0.5 text-xs text-slate-500">Optional steps you skipped — add them whenever you're ready.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenSetup} className="text-xs font-medium text-accent hover:underline">
            Open setup assistant
          </button>
          <button onClick={dismiss} className="text-xs text-slate-500 hover:text-slate-300" title="Hide this card">
            ✕
          </button>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-xs">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            <span>
              <span className="text-slate-200">{item.label}.</span> <span className="text-slate-500">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
