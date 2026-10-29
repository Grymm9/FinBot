import { useCallback, useEffect, useState } from 'react'
import type { BankStatus, DashboardSummary, Settings as SettingsMap } from '@shared/types'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import Budgets from './components/Budgets'
import Insurance from './components/Insurance'
import Email from './components/Email'
import Accounts from './components/Accounts'
import Mapping from './components/Mapping'
import Notifications from './components/Notifications'
import Reminders from './components/Reminders'
import MemoryPage from './components/Memory'
import Transactions from './components/Transactions'
import Subscriptions from './components/Subscriptions'
import Deals from './components/Deals'
import Goals from './components/Goals'
import Settings from './components/Settings'
import ChatSidebar from './components/ChatSidebar'
import Onboarding from './components/Onboarding'
import SetupChecklist from './components/SetupChecklist'
import { Spinner } from './components/ui'

export type View =
  | 'dashboard'
  | 'budgets'
  | 'transactions'
  | 'subscriptions'
  | 'deals'
  | 'goals'
  | 'mapping'
  | 'insurance'
  | 'email'
  | 'accounts'
  | 'settings'
  | 'notifications'
  | 'reminders'
  | 'memory'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('dashboard')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [bankStatus, setBankStatus] = useState<BankStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [settings, setSettings] = useState<SettingsMap | null>(null)
  const [restartSetup, setRestartSetup] = useState(false)

  const loadSettings = useCallback(async (): Promise<void> => {
    setSettings(await window.api.getSettings())
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [s, b] = await Promise.all([
        window.api.getDashboardSummary(),
        window.api.getBankStatus()
      ])
      setSummary(s)
      setBankStatus(b)
    } catch (e) {
      console.error('Failed to load dashboard:', e)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    void loadSettings()
  }, [refresh, loadSettings])

  // First run (or "Run setup again" in Settings) takes over the whole window.
  if (settings === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-transparent">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (restartSetup || settings.ONBOARDING_COMPLETED !== '1') {
    return (
      <Onboarding
        onDone={async () => {
          setRestartSetup(false)
          await loadSettings()
          await refresh()
        }}
      />
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-transparent text-slate-200">
      <Sidebar
        view={view}
        setView={setView}
        bankStatus={bankStatus}
        notificationCount={
          (summary?.missedPayments.length ?? 0) +
          (summary?.duplicateCharges.length ?? 0) +
          (summary?.insights.length ?? 0) +
          (summary?.aiUnread ?? 0)
        }
        onSync={refresh}
      />

      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <div key={view} className="animate-fade-in mx-auto max-w-5xl">
          {view === 'dashboard' && (
            <>
              <SetupChecklist settings={settings} bankStatus={bankStatus} onOpenSetup={() => setRestartSetup(true)} />
              <Dashboard
                summary={summary}
                refreshing={refreshing}
                onSync={refresh}
                onViewNotifications={() => setView('notifications')}
              />
            </>
          )}
          {view === 'budgets' && <Budgets summary={summary} onChanged={refresh} />}
          {view === 'transactions' && <Transactions />}
          {view === 'subscriptions' && <Subscriptions onChanged={refresh} />}
          {view === 'deals' && <Deals />}
          {view === 'goals' && <Goals onChanged={refresh} />}
          {view === 'mapping' && <Mapping onChanged={refresh} />}
          {view === 'insurance' && <Insurance onChanged={refresh} />}
          {view === 'email' && <Email onChanged={refresh} />}
          {view === 'accounts' && <Accounts onChanged={refresh} />}
          {view === 'settings' && (
            <Settings onChanged={refresh} onRestartSetup={() => setRestartSetup(true)} />
          )}
          {view === 'notifications' && <Notifications summary={summary} onChanged={refresh} />}
          {view === 'reminders' && <Reminders onChanged={refresh} />}
          {view === 'memory' && <MemoryPage onChanged={refresh} />}
        </div>
      </main>

      <ChatSidebar onDataChanged={refresh} />
    </div>
  )
}
