import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { readFile } from 'node:fs/promises'
import { getDb } from './db'
import { syncAll } from './services/akahu'
import { importTransactionsCsv } from './services/tx-import'
import { importBudgetCsv, importBudgetOcr, listCategories, setCategoryBudget, setCategorySplit, setCategoryActiveFrom, deleteCategory, clearCategories, listRules, addRule, removeRule, listUnmatchedMerchants, listCardMappings, setCardMapping, removeCardMapping } from './services/budget'
import { recognizeImage } from './services/ocr'
import {
  importPolicyPdf,
  importPolicyPdfs,
  listPolicies,
  updatePolicy,
  deletePolicy,
  linkPoliciesToTransactions,
  createPolicy,
  storePolicyFile,
  attachPdfToPolicy,
  openPolicyFile,
  linkPolicyToTransaction,
  unlinkPolicy,
  listDeductions,
  listBundles,
  createBundle,
  addBundleItem,
  removeBundleItem,
  deleteBundle,
  renameBundle,
  linkBundleToTransaction,
  unlinkBundle,
  attachPdfToBundle,
  openBundleFile
} from './services/insurance'
import { getDashboardSummary, getBankStatus, listTransactions, listAccounts, setAccountEnabled } from './services/dashboard'
import { listGroups, createGroup, addDestination, updateDestination, removeDestination, deleteGroup, removeGroupItem, addGroupItem, listCategoryDestinations, addCategoryDestination, updateCategoryDestination, removeCategoryDestination } from './services/groups'
import { listPaymentCandidates, matchPayment, unmatchPayment } from './services/payments'
import { listManualAssets, addManualAsset, updateManualAsset, removeManualAsset } from './services/assets'
import { testDiscord } from './services/discord'
import { notifyUncategorized, processDiscordReplies } from './services/discord-resolution'
import { scanEmails, listEmails, setEmailRelevant } from './services/email'
import { checkAndAlert, evaluateBudget } from './services/alerts'
import { dismissAlert } from './services/notifications'
import {
  getAiAlertFeed,
  refreshAiAlerts,
  markAiAlertRead,
  dismissAiAlert
} from './services/ai-alerts'
import { listUserReminders, createUserReminder, deleteUserReminder } from './services/reminders'
import { searchTransactions } from './services/transactions'
import {
  listSubscriptions,
  refreshSubscriptions,
  ignoreSubscription,
  unignoreSubscription,
  subscriptionMonthlyTotal
} from './services/subscriptions'
import { listGoals, createGoal, updateGoal, deleteGoal, contributeToGoal } from './services/goals'
import { createBackup, listBackups, restoreBackup, exportTransactionsCsv } from './services/backup'
import { getSetting, setSetting, getAllSettings } from './services/settings'
import { getHealth } from './services/health'
import { buildCashFlowForecast } from './services/forecast'
import { listReviews, latestReview } from './services/reviews'
import { listActions, undoAction } from './services/ai-actions'
import { runAiEvals, lastEvalRun } from './services/ai-eval'
import { checkForUpdate, getUpdateStatus, installUpdate } from './services/updater'
import {
  addDealPlan,
  compareLink,
  deleteDealPlan,
  getDealsReport,
  refreshDealPrices,
  setPowerUsage
} from './services/deals'
import { buildFinancialContext } from './services/context'
import { streamChat, baseSystemPrompt, testAiConnection } from './services/deepseek'
import { currentCycleRange } from './services/cycle'
import {
  listMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  searchMemory,
  distillMemories,
  listConversations,
  recentConversationMessages,
  memoryBlock,
  recordConversation
} from './services/memory'
import type { ChatMessage, DealCategory, DealPlanInput } from '@shared/types'

const CSV_FILTERS = [{ name: 'CSV files', extensions: ['csv'] }]
const PDF_FILTERS = [{ name: 'PDF files', extensions: ['pdf'] }]
const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }]

function dbChatHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
  return recentConversationMessages()
}

export function registerIpcHandlers(): void {
  // ------------------------------------------------------------------ settings
  ipcMain.handle('settings:get', () => getAllSettings())
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    setSetting(key, value)
    return getAllSettings()
  })
  ipcMain.handle('settings:get-masked', () => {
    const mask = (v: string): string => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '')
    return {
      AKAHU_APP_TOKEN: mask(getSetting('AKAHU_APP_TOKEN')),
      AKAHU_USER_TOKEN: mask(getSetting('AKAHU_USER_TOKEN')),
      DEEPSEEK_API_KEY: mask(getSetting('DEEPSEEK_API_KEY')),
      DEEPSEEK_BASE_URL: getSetting('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
      DEEPSEEK_MODEL: getSetting('DEEPSEEK_MODEL', 'deepseek-chat'),
      DISCORD_WEBHOOK_URL: getSetting('DISCORD_WEBHOOK_URL'),
      DISCORD_BOT_TOKEN: getSetting('DISCORD_BOT_TOKEN'),
      DISCORD_CHANNEL_ID: getSetting('DISCORD_CHANNEL_ID'),
      EMAIL_ADDRESS: getSetting('EMAIL_ADDRESS'),
      EMAIL_PASSWORD: getSetting('EMAIL_PASSWORD'),
      EMAIL_HOST: getSetting('EMAIL_HOST', 'imap.gmail.com'),
      EMAIL_PORT: getSetting('EMAIL_PORT', '993'),
      EMAIL_LABEL: getSetting('EMAIL_LABEL', 'Important Finances'),
      INCOME_CYCLE_DAY: getSetting('INCOME_CYCLE_DAY', '15'),
      INCOME_CYCLE_FREQUENCY: getSetting('INCOME_CYCLE_FREQUENCY', 'monthly'),
      INCOME_CYCLE_WEEKEND: getSetting('INCOME_CYCLE_WEEKEND', 'previous'),
      INCOME_CYCLE_ANCHOR: getSetting('INCOME_CYCLE_ANCHOR'),
      BUDGET_CHECK_DAY: getSetting('BUDGET_CHECK_DAY', '15'),
      BUDGET_ACTIVE_FROM: getSetting('BUDGET_ACTIVE_FROM'),
      ALERT_SPEND_RATIO: getSetting('ALERT_SPEND_RATIO', '0.8'),
      AUTO_SYNC_HOURS: getSetting('AUTO_SYNC_HOURS', '4'),
      DISCORD_USE_THREADS: getSetting('DISCORD_USE_THREADS', '1'),
      UPDATE_FEED_PATH: getSetting('UPDATE_FEED_PATH', ''),
      UPDATE_FEED_URL: getSetting('UPDATE_FEED_URL', ''),
      AUTO_UPDATE: getSetting('AUTO_UPDATE', '1'),
      AUTO_UPDATE_DOWNLOAD: getSetting('AUTO_UPDATE_DOWNLOAD', '1'),
      LOW_BALANCE_BUFFER: getSetting('LOW_BALANCE_BUFFER', '50'),
      LARGE_TX_MIN: getSetting('LARGE_TX_MIN', '300'),
      LARGE_TX_DAYS: getSetting('LARGE_TX_DAYS', '3')
    }
  })

  // -------------------------------------------------------------------- akahu
  ipcMain.handle('bank:sync', async () => {
    const result = await syncAll()
    // Fire-and-forget the two-way Discord workflow after a sync.
    void notifyUncategorized().catch(() => {})
    void processDiscordReplies().catch(() => {})
    return result
  })
  ipcMain.handle('bank:status', () => getBankStatus())
  ipcMain.handle('transactions:list', (_e, limit?: number) => listTransactions(limit ?? 200))
  ipcMain.handle('transactions:import-csv', async (_e, accountName?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: CSV_FILTERS
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const text = await readFile(res.filePaths[0], 'utf-8')
    return {
      canceled: false,
      fileName: res.filePaths[0].split(/[\\/]/).pop() ?? null,
      ...importTransactionsCsv(text, { accountName, fileName: res.filePaths[0] })
    }
  })
  ipcMain.handle('cycle:current', () => currentCycleRange())

  // ------------------------------------------------------------------- budget
  ipcMain.handle('budget:import-csv', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: CSV_FILTERS
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const text = await readFile(res.filePaths[0], 'utf-8')
    const result = importBudgetCsv(text)
    return { canceled: false, ...result }
  })
  ipcMain.handle('budget:list', () => listCategories())
  ipcMain.handle('budget:set', (_e, name: string, amount: number, frequency?: string) => setCategoryBudget(name, amount, frequency ?? 'monthly'))
  ipcMain.handle('budget:set-split', (_e, name: string, split: boolean) => setCategorySplit(name, split))
  ipcMain.handle('budget:set-active-from', (_e, name: string, date: string) => setCategoryActiveFrom(name, date))
  ipcMain.handle('budget:delete', (_e, name: string) => deleteCategory(name))
  ipcMain.handle('budget:clear', () => clearCategories())

  // ------------------------------------------------------------- accounts
  ipcMain.handle('accounts:list', () => listAccounts())
  ipcMain.handle('accounts:set-enabled', (_e, id: string, enabled: boolean) => setAccountEnabled(id, enabled))

  // -------------------------------------------------------- category rules
  ipcMain.handle('rules:list', () => listRules())
  ipcMain.handle('rules:add', (_e, keyword: string, category: string) => addRule(keyword, category))
  ipcMain.handle('rules:remove', (_e, id: number) => removeRule(id))
  ipcMain.handle('merchants:unmatched', () => listUnmatchedMerchants())
  ipcMain.handle('cardmapping:list', () => listCardMappings())
  ipcMain.handle('cardmapping:set', (_e, card: string, category: string) => setCardMapping(card, category))
  ipcMain.handle('cardmapping:remove', (_e, card: string) => removeCardMapping(card))

  // --------------------------------------------------------------- groups
  ipcMain.handle('groups:list', () => listGroups())
  ipcMain.handle('groups:create', (_e, categories: string[]) => createGroup(categories))
  ipcMain.handle(
    'groups:add-destination',
    (
      _e,
      groupId: number,
      fields: { amount?: number | null; accountNumber?: string | null; accountType?: string | null; transferLabel?: string | null }
    ) => addDestination(groupId, fields)
  )
  ipcMain.handle(
    'groups:update-destination',
    (
      _e,
      destId: number,
      fields: { amount?: number | null; accountNumber?: string | null; accountType?: string | null; transferLabel?: string | null }
    ) => updateDestination(destId, fields)
  )
  ipcMain.handle('groups:remove-destination', (_e, destId: number) => removeDestination(destId))
  ipcMain.handle('groups:delete', (_e, id: number) => deleteGroup(id))
  ipcMain.handle('groups:remove-item', (_e, groupId: number, category: string) => removeGroupItem(groupId, category))
  ipcMain.handle('groups:add-item', (_e, groupId: number, category: string) => addGroupItem(groupId, category))

  // ------------------------------------------------- singular category routing
  ipcMain.handle('category-routing:list', () => listCategoryDestinations())
  ipcMain.handle(
    'category-routing:add',
    (
      _e,
      category: string,
      fields: { amount?: number | null; accountNumber?: string | null; accountType?: string | null; transferLabel?: string | null }
    ) => addCategoryDestination(category, fields)
  )
  ipcMain.handle(
    'category-routing:update',
    (
      _e,
      destId: number,
      fields: { amount?: number | null; accountNumber?: string | null; accountType?: string | null; transferLabel?: string | null }
    ) => updateCategoryDestination(destId, fields)
  )
  ipcMain.handle('category-routing:remove', (_e, destId: number) => removeCategoryDestination(destId))

  // --------------------------------------------------------- payment matching
  ipcMain.handle('payments:candidates', () => listPaymentCandidates())
  ipcMain.handle(
    'payments:match',
    (_e, destinationId: number, transactionId: string, kind: 'group' | 'category') =>
      matchPayment(destinationId, transactionId, kind ?? 'group')
  )
  ipcMain.handle('payments:unmatch', (_e, destinationId: number, kind: 'group' | 'category') =>
    unmatchPayment(destinationId, kind ?? 'group')
  )

  // ------------------------------------------------------------ manual assets
  ipcMain.handle('assets:list', () => listManualAssets())
  ipcMain.handle('assets:add', (_e, name: string, amount: number) => addManualAsset(name, amount))
  ipcMain.handle('assets:update', (_e, id: number, fields: { name?: string; amount?: number }) => updateManualAsset(id, fields))
  ipcMain.handle('assets:remove', (_e, id: number) => removeManualAsset(id))
  ipcMain.handle('budget:import-image', async (_e, filePath: string) => {
    const text = await recognizeImage(filePath)
    const result = importBudgetOcr(text)
    return { canceled: false, ocrText: text, ...result }
  })
  ipcMain.handle('budget:import-image-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: IMAGE_FILTERS
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const text = await recognizeImage(res.filePaths[0])
    const result = importBudgetOcr(text)
    return { canceled: false, ocrText: text, ...result }
  })

  // -------------------------------------------------------------- insurance
  ipcMain.handle('insurance:import-pdf', async (_e, filePath: string) => importPolicyPdf(filePath))
  ipcMain.handle('insurance:import-pdfs', async (_e, filePaths: string[]) => importPolicyPdfs(filePaths))
  ipcMain.handle('insurance:import-pdf-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: PDF_FILTERS
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const result = await importPolicyPdfs(res.filePaths)
    return { canceled: false, ...result }
  })
  ipcMain.handle('insurance:list', () => listPolicies())
  ipcMain.handle(
    'insurance:update',
    (
      _e,
      id: number,
      fields: { provider?: string; coverType?: string; premium?: number; frequency?: string; renewalDate?: string }
    ) => updatePolicy(id, fields)
  )
  ipcMain.handle('insurance:delete', (_e, id: number) => deletePolicy(id))
  ipcMain.handle('insurance:link', () => linkPoliciesToTransactions())
  ipcMain.handle('insurance:create', (_e, fields) => createPolicy(fields))
  ipcMain.handle('insurance:link-transaction', (_e, policyId: number, transactionId: string) =>
    linkPolicyToTransaction(policyId, transactionId)
  )
  ipcMain.handle('insurance:unlink', (_e, policyId: number) => unlinkPolicy(policyId))
  ipcMain.handle('insurance:deductions', () => listDeductions())
  ipcMain.handle('insurance:bundles', () => listBundles())
  ipcMain.handle('insurance:bundle-create', (_e, name: string | null, policyIds: number[]) =>
    createBundle(name, policyIds)
  )
  ipcMain.handle('insurance:bundle-add', (_e, bundleId: number, policyId: number) => addBundleItem(bundleId, policyId))
  ipcMain.handle('insurance:bundle-remove-item', (_e, bundleId: number, policyId: number) =>
    removeBundleItem(bundleId, policyId)
  )
  ipcMain.handle('insurance:bundle-delete', (_e, bundleId: number) => deleteBundle(bundleId))
  ipcMain.handle('insurance:bundle-rename', (_e, bundleId: number, name: string) => renameBundle(bundleId, name))
  ipcMain.handle('insurance:bundle-link', (_e, bundleId: number, transactionId: string) =>
    linkBundleToTransaction(bundleId, transactionId)
  )
  ipcMain.handle('insurance:bundle-unlink', (_e, bundleId: number) => unlinkBundle(bundleId))
  ipcMain.handle('insurance:bundle-attach-pdf-dialog', async (_e, bundleId: number) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: PDF_FILTERS })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const bundles = await attachPdfToBundle(bundleId, res.filePaths[0])
    return { canceled: false, bundles }
  })
  ipcMain.handle('insurance:bundle-open-pdf', (_e, bundleId: number) => openBundleFile(bundleId))
  ipcMain.handle('insurance:store-pdf-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: PDF_FILTERS })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const { name } = await storePolicyFile(res.filePaths[0])
    return { canceled: false, name }
  })
  ipcMain.handle('insurance:attach-pdf-dialog', async (_e, id: number) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: PDF_FILTERS })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const policy = await attachPdfToPolicy(id, res.filePaths[0])
    return { canceled: false, policy }
  })
  ipcMain.handle('insurance:open-pdf', (_e, id: number) => openPolicyFile(id))

  // ------------------------------------------------------------------ alerts
  ipcMain.handle('discord:test', () => testDiscord())
  ipcMain.handle('discord:notify-uncategorized', () => notifyUncategorized())
  ipcMain.handle('discord:check-replies', () => processDiscordReplies())
  ipcMain.handle('email:scan', () => scanEmails())
  ipcMain.handle('email:list', () => listEmails())
  ipcMain.handle('email:set-relevant', (_e, id: number, relevant: boolean) => setEmailRelevant(id, relevant))
  ipcMain.handle('alerts:run', () => checkAndAlert())
  ipcMain.handle('alerts:preview', () => ({ flags: evaluateBudget() }))
  ipcMain.handle('notifications:dismiss', (_e, key: string) => dismissAlert(key))
  ipcMain.handle('ai-alerts:list', () => getAiAlertFeed())
  ipcMain.handle('ai-alerts:refresh', () => refreshAiAlerts())
  ipcMain.handle('ai-alerts:read', (_e, id: number) => markAiAlertRead(id))
  ipcMain.handle('ai-alerts:dismiss', (_e, id: number) => dismissAiAlert(id))
  ipcMain.handle('reminders:list', () => listUserReminders())
  ipcMain.handle('reminders:create', (_e, message: string, targetDate: string, repeat: string) =>
    createUserReminder(message, targetDate, repeat)
  )
  ipcMain.handle('reminders:delete', (_e, id: number) => deleteUserReminder(id))

  // ------------------------------------------------------------ transactions
  ipcMain.handle(
    'transactions:search',
    (
      _e,
      filter: {
        query?: string
        category?: string
        accountId?: string
        from?: string
        to?: string
        limit?: number
      }
    ) => searchTransactions(filter)
  )

  // ----------------------------------------------------------- subscriptions
  ipcMain.handle('subscriptions:list', () => ({
    items: listSubscriptions(),
    monthlyTotal: subscriptionMonthlyTotal()
  }))
  ipcMain.handle('subscriptions:refresh', () => ({
    items: refreshSubscriptions(),
    monthlyTotal: subscriptionMonthlyTotal()
  }))
  ipcMain.handle('subscriptions:ignore', (_e, key: string) => {
    ignoreSubscription(key)
    return { items: listSubscriptions(), monthlyTotal: subscriptionMonthlyTotal() }
  })
  ipcMain.handle('subscriptions:unignore', (_e, key: string) => {
    unignoreSubscription(key)
    return { items: refreshSubscriptions(), monthlyTotal: subscriptionMonthlyTotal() }
  })

  // ------------------------------------------------------------------- goals
  ipcMain.handle('goals:list', () => listGoals())
  ipcMain.handle(
    'goals:create',
    (_e, name: string, targetAmount: number, savedAmount: number, targetDate: string | null) =>
      createGoal(name, targetAmount, savedAmount, targetDate)
  )
  ipcMain.handle(
    'goals:update',
    (
      _e,
      id: number,
      fields: { name?: string; targetAmount?: number; savedAmount?: number; targetDate?: string | null }
    ) => updateGoal(id, fields)
  )
  ipcMain.handle('goals:contribute', (_e, id: number, amount: number) => contributeToGoal(id, amount))
  ipcMain.handle('goals:delete', (_e, id: number) => deleteGoal(id))

  // ----------------------------------------------------------------- backups
  ipcMain.handle('backup:list', () => listBackups())
  ipcMain.handle('backup:create', () => createBackup(true))
  ipcMain.handle('backup:restore', (_e, fileName: string) => restoreBackup(fileName))
  ipcMain.handle('backup:export-csv', (event) =>
    exportTransactionsCsv(BrowserWindow.fromWebContents(event.sender))
  )

  // -------------------------------------------------------------- dashboard
  ipcMain.handle('dashboard:summary', () => getDashboardSummary())

  // ------------------------------------------------------- health / forecast
  ipcMain.handle('health:list', () => getHealth())
  ipcMain.handle('forecast:get', () => buildCashFlowForecast())
  ipcMain.handle('reviews:list', (_e, limit?: number) => listReviews(limit ?? 6))
  ipcMain.handle('reviews:latest', () => latestReview())

  // ------------------------------------------------------------------- deals
  ipcMain.handle('deals:report', () => getDealsReport())
  ipcMain.handle('deals:refresh', () => refreshDealPrices())
  ipcMain.handle('deals:add-plan', (_e, input: DealPlanInput) => addDealPlan(input))
  ipcMain.handle('deals:delete-plan', (_e, id: number) => deleteDealPlan(id))
  ipcMain.handle('deals:set-usage', (_e, kwh: number) => setPowerUsage(kwh))
  ipcMain.handle('deals:open-compare', async (_e, category: DealCategory) => {
    await shell.openExternal(compareLink(category).url)
  })

  // -------------------------------------------------------------- ai actions
  ipcMain.handle('ai:actions', (_e, limit?: number) => listActions(limit ?? 30))
  ipcMain.handle('ai:undo', (_e, id: number) => undoAction(id))
  ipcMain.handle('ai:eval', () => runAiEvals())
  ipcMain.handle('ai:eval-last', () => lastEvalRun())

  // ----------------------------------------------------------------- updates
  ipcMain.handle('update:status', () => getUpdateStatus())
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:install', () => installUpdate())

  // -------------------------------------------------------------------- chat
  ipcMain.handle('chat:history', (): ChatMessage[] => {
    const rows = getDb()
      .prepare(
        "SELECT id, role, content, created_at, channel FROM chat_logs WHERE channel = 'app' ORDER BY id ASC"
      )
      .all() as Array<{ id: number; role: string; content: string; created_at: number; channel: string }>
    return rows.map((r) => ({
      id: r.id,
      role: r.role as ChatMessage['role'],
      content: r.content,
      createdAt: r.created_at,
      channel: 'app'
    }))
  })

  ipcMain.handle('chat:clear', () => {
    getDb().prepare("DELETE FROM chat_logs WHERE channel = 'app'").run()
  })

  // ------------------------------------------------------------------ memory
  ipcMain.handle('memory:list', () => listMemories())
  ipcMain.handle('memory:create', (_e, content: string, kind: string) => createMemory(content, kind, 'user'))
  ipcMain.handle(
    'memory:update',
    (_e, id: number, fields: { content?: string; kind?: string; pinned?: boolean }) => updateMemory(id, fields)
  )
  ipcMain.handle('memory:delete', (_e, id: number) => deleteMemory(id))
  ipcMain.handle('memory:search', (_e, query: string) => searchMemory(query))
  ipcMain.handle('memory:conversations', (_e, limit?: number) => listConversations(limit))
  ipcMain.handle('memory:distill', async (_e, force?: boolean) => ({
    added: await distillMemories(force === true)
  }))

  ipcMain.handle('ai:test', () => testAiConnection())

  // ------------------------------------------------------------- app / setup
  ipcMain.handle('app:launch-at-login', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:set-launch-at-login', (_e, enabled: boolean) => {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
    }
    setSetting('LAUNCH_AT_LOGIN', enabled ? '1' : '0')
    return enabled
  })

  ipcMain.on('chat:send', async (event, userText: string) => {
    recordConversation('app', 'user', userText)

    const context = buildFinancialContext()
    const messages = [
      { role: 'system' as const, content: baseSystemPrompt() },
      { role: 'system' as const, content: memoryBlock() },
      { role: 'system' as const, content: `<financial_context>\n${context}\n</financial_context>` },
      ...dbChatHistory().map((m) => ({ role: m.role, content: m.content }))
    ]

    try {
      const reply = await streamChat({
        messages,
        onToken: (token) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:token', token)
          }
        },
        onReasoning: (token) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:reasoning', token)
          }
        },
        onTool: (name, summary, actionId) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:tool', { name, summary, actionId })
          }
        }
      })
      recordConversation('app', 'assistant', reply.content)
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:done', reply.content)
      }
    } catch (e) {
      const msg = (e as Error).message
      recordConversation('app', 'assistant', `[error] ${msg}`)
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:error', msg)
      }
    }
  })
}
