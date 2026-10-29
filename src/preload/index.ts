import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  AlertResult,
  Account,
  BankStatus,
  BudgetImportResult,
  BudgetGroup,
  CardMapping,
  Category,
  CategoryRule,
  CategoryRouting,
  ChatMessage,
  DashboardSummary,
  Deduction,
  EmailScanResult,
  EmailRecord,
  InsuranceBundle,
  InsurancePolicy,
  ManualAsset,
  MatchedPayment,
  Memory,
  MemorySearchResult,
  ConversationEntry,
  Subscription,
  Goal,
  TransactionSearchResult,
  BackupInfo,
  Reminder,
  Settings,
  SyncResult,
  Transaction,
  TransactionImportResult,
  UnmatchedMerchant,
  ServiceHealth,
  ForecastSummary,
  CycleReview,
  AiAction,
  AiAlertFeed,
  EvalReport,
  UpdateStatus,
  DealCategory,
  DealPlanInput,
  DealsReport
} from '@shared/types'

const api = {
  // settings
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: string): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', key, value),
  getMaskedSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get-masked'),

  // bank / akahu
  syncBank: (): Promise<SyncResult> => ipcRenderer.invoke('bank:sync'),
  getBankStatus: (): Promise<BankStatus> => ipcRenderer.invoke('bank:status'),
  listTransactions: (limit?: number): Promise<Transaction[]> =>
    ipcRenderer.invoke('transactions:list', limit),

  // accounts
  listAccounts: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
  setAccountEnabled: (id: string, enabled: boolean): Promise<Account[]> =>
    ipcRenderer.invoke('accounts:set-enabled', id, enabled),

  // category rules / mapping
  listRules: (): Promise<CategoryRule[]> => ipcRenderer.invoke('rules:list'),
  addRule: (keyword: string, category: string): Promise<CategoryRule[]> =>
    ipcRenderer.invoke('rules:add', keyword, category),
  removeRule: (id: number): Promise<CategoryRule[]> => ipcRenderer.invoke('rules:remove', id),
  listUnmatchedMerchants: (): Promise<UnmatchedMerchant[]> =>
    ipcRenderer.invoke('merchants:unmatched'),
  listCardMappings: (): Promise<CardMapping[]> => ipcRenderer.invoke('cardmapping:list'),
  setCardMapping: (card: string, category: string): Promise<CardMapping[]> =>
    ipcRenderer.invoke('cardmapping:set', card, category),
  removeCardMapping: (card: string): Promise<CardMapping[]> =>
    ipcRenderer.invoke('cardmapping:remove', card),

  // groups
  listGroups: (): Promise<BudgetGroup[]> => ipcRenderer.invoke('groups:list'),
  createGroup: (categories: string[]): Promise<BudgetGroup[]> =>
    ipcRenderer.invoke('groups:create', categories),
  addDestination: (
    groupId: number,
    fields: {
      amount?: number | null
      accountNumber?: string | null
      accountType?: string | null
      transferLabel?: string | null
    }
  ): Promise<BudgetGroup[]> => ipcRenderer.invoke('groups:add-destination', groupId, fields),
  updateDestination: (
    destId: number,
    fields: {
      amount?: number | null
      accountNumber?: string | null
      accountType?: string | null
      transferLabel?: string | null
    }
  ): Promise<BudgetGroup[]> => ipcRenderer.invoke('groups:update-destination', destId, fields),
  removeDestination: (destId: number): Promise<BudgetGroup[]> =>
    ipcRenderer.invoke('groups:remove-destination', destId),
  deleteGroup: (id: number): Promise<BudgetGroup[]> => ipcRenderer.invoke('groups:delete', id),
  removeGroupItem: (groupId: number, category: string): Promise<BudgetGroup[]> =>
    ipcRenderer.invoke('groups:remove-item', groupId, category),
  addGroupItem: (groupId: number, category: string): Promise<BudgetGroup[]> =>
    ipcRenderer.invoke('groups:add-item', groupId, category),
  listCategoryDestinations: (): Promise<CategoryRouting[]> =>
    ipcRenderer.invoke('category-routing:list'),
  addCategoryDestination: (
    category: string,
    fields: {
      amount?: number | null
      accountNumber?: string | null
      accountType?: string | null
      transferLabel?: string | null
    }
  ): Promise<CategoryRouting[]> => ipcRenderer.invoke('category-routing:add', category, fields),
  updateCategoryDestination: (
    destId: number,
    fields: {
      amount?: number | null
      accountNumber?: string | null
      accountType?: string | null
      transferLabel?: string | null
    }
  ): Promise<CategoryRouting[]> => ipcRenderer.invoke('category-routing:update', destId, fields),
  removeCategoryDestination: (destId: number): Promise<CategoryRouting[]> =>
    ipcRenderer.invoke('category-routing:remove', destId),

  // payment matching
  listPaymentCandidates: (): Promise<Deduction[]> => ipcRenderer.invoke('payments:candidates'),
  matchPayment: (
    destinationId: number,
    transactionId: string,
    kind: 'group' | 'category'
  ): Promise<MatchedPayment[]> => ipcRenderer.invoke('payments:match', destinationId, transactionId, kind),
  unmatchPayment: (destinationId: number, kind: 'group' | 'category'): Promise<MatchedPayment[]> =>
    ipcRenderer.invoke('payments:unmatch', destinationId, kind),

  // manual assets / savings
  listManualAssets: (): Promise<ManualAsset[]> => ipcRenderer.invoke('assets:list'),
  addManualAsset: (name: string, amount: number): Promise<ManualAsset[]> =>
    ipcRenderer.invoke('assets:add', name, amount),
  updateManualAsset: (id: number, fields: { name?: string; amount?: number }): Promise<ManualAsset[]> =>
    ipcRenderer.invoke('assets:update', id, fields),
  removeManualAsset: (id: number): Promise<ManualAsset[]> => ipcRenderer.invoke('assets:remove', id),

  // budget
  importBudgetCsv: (): Promise<{ canceled: boolean } & Partial<BudgetImportResult>> =>
    ipcRenderer.invoke('budget:import-csv'),
  importBudgetImage: (filePath: string): Promise<BudgetImportResult> =>
    ipcRenderer.invoke('budget:import-image', filePath),
  importBudgetImageDialog: (): Promise<{ canceled: boolean } & Partial<BudgetImportResult>> =>
    ipcRenderer.invoke('budget:import-image-dialog'),
  listCategories: (): Promise<Category[]> => ipcRenderer.invoke('budget:list'),
  setCategoryBudget: (name: string, amount: number, frequency?: string): Promise<Category[]> =>
    ipcRenderer.invoke('budget:set', name, amount, frequency),
  setCategorySplit: (name: string, split: boolean): Promise<Category[]> =>
    ipcRenderer.invoke('budget:set-split', name, split),
  setCategoryActiveFrom: (name: string, date: string): Promise<Category[]> =>
    ipcRenderer.invoke('budget:set-active-from', name, date),
  deleteCategory: (name: string): Promise<Category[]> => ipcRenderer.invoke('budget:delete', name),
  clearCategories: (): Promise<Category[]> => ipcRenderer.invoke('budget:clear'),

  // insurance
  importInsurancePdf: (filePath: string): Promise<InsurancePolicy> =>
    ipcRenderer.invoke('insurance:import-pdf', filePath),
  importInsurancePdfs: (
    filePaths: string[]
  ): Promise<{ imported: number; policies: InsurancePolicy[] }> =>
    ipcRenderer.invoke('insurance:import-pdfs', filePaths),
  importInsurancePdfDialog: (): Promise<{ canceled: boolean; imported?: number; policies?: InsurancePolicy[] }> =>
    ipcRenderer.invoke('insurance:import-pdf-dialog'),
  listPolicies: (): Promise<InsurancePolicy[]> => ipcRenderer.invoke('insurance:list'),
  updatePolicy: (
    id: number,
    fields: { provider?: string; coverType?: string; premium?: number; frequency?: string; renewalDate?: string }
  ): Promise<InsurancePolicy> => ipcRenderer.invoke('insurance:update', id, fields),
  deletePolicy: (id: number): Promise<void> => ipcRenderer.invoke('insurance:delete', id),
  linkPolicies: (): Promise<{ linked: number }> => ipcRenderer.invoke('insurance:link'),
  createPolicy: (fields: {
    provider?: string | null
    coverType?: string | null
    premium?: number | null
    frequency?: string | null
    renewalDate?: string | null
    sourceFile?: string | null
  }): Promise<InsurancePolicy> => ipcRenderer.invoke('insurance:create', fields),
  storePdfDialog: (): Promise<{ canceled: boolean; name?: string }> =>
    ipcRenderer.invoke('insurance:store-pdf-dialog'),
  attachPdfDialog: (id: number): Promise<{ canceled: boolean; policy?: InsurancePolicy }> =>
    ipcRenderer.invoke('insurance:attach-pdf-dialog', id),
  openPolicyFile: (id: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('insurance:open-pdf', id),
  linkPolicyToTransaction: (policyId: number, transactionId: string): Promise<InsurancePolicy> =>
    ipcRenderer.invoke('insurance:link-transaction', policyId, transactionId),
  unlinkPolicy: (policyId: number): Promise<InsurancePolicy> =>
    ipcRenderer.invoke('insurance:unlink', policyId),
  listDeductions: (): Promise<Deduction[]> => ipcRenderer.invoke('insurance:deductions'),
  listBundles: (): Promise<InsuranceBundle[]> => ipcRenderer.invoke('insurance:bundles'),
  createBundle: (name: string | null, policyIds: number[]): Promise<InsuranceBundle[]> =>
    ipcRenderer.invoke('insurance:bundle-create', name, policyIds),
  addBundleItem: (bundleId: number, policyId: number): Promise<InsuranceBundle[]> =>
    ipcRenderer.invoke('insurance:bundle-add', bundleId, policyId),
  removeBundleItem: (bundleId: number, policyId: number): Promise<InsuranceBundle[]> =>
    ipcRenderer.invoke('insurance:bundle-remove-item', bundleId, policyId),
  deleteBundle: (bundleId: number): Promise<InsuranceBundle[]> =>
    ipcRenderer.invoke('insurance:bundle-delete', bundleId),
  renameBundle: (bundleId: number, name: string): Promise<InsuranceBundle[]> =>
    ipcRenderer.invoke('insurance:bundle-rename', bundleId, name),
  linkBundleToTransaction: (bundleId: number, transactionId: string): Promise<InsuranceBundle[]> =>
    ipcRenderer.invoke('insurance:bundle-link', bundleId, transactionId),
  unlinkBundle: (bundleId: number): Promise<InsuranceBundle[]> =>
    ipcRenderer.invoke('insurance:bundle-unlink', bundleId),
  attachBundlePdfDialog: (bundleId: number): Promise<{ canceled: boolean; bundles?: InsuranceBundle[] }> =>
    ipcRenderer.invoke('insurance:bundle-attach-pdf-dialog', bundleId),
  openBundleFile: (bundleId: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('insurance:bundle-open-pdf', bundleId),

  // alerts
  testDiscord: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('discord:test'),
  notifyUncategorized: (): Promise<{ count: number }> =>
    ipcRenderer.invoke('discord:notify-uncategorized'),
  checkDiscordReplies: (): Promise<{ processed: number; replied: number; error?: string }> =>
    ipcRenderer.invoke('discord:check-replies'),
  scanEmails: (): Promise<EmailScanResult> => ipcRenderer.invoke('email:scan'),
  listEmails: (): Promise<EmailRecord[]> => ipcRenderer.invoke('email:list'),
  setEmailRelevant: (id: number, relevant: boolean): Promise<EmailRecord[]> =>
    ipcRenderer.invoke('email:set-relevant', id, relevant),
  runBudgetCheck: (): Promise<AlertResult> => ipcRenderer.invoke('alerts:run'),
  previewAlerts: (): Promise<{ flags: AlertResult['flags'] }> => ipcRenderer.invoke('alerts:preview'),
  dismissAlert: (key: string): Promise<void> => ipcRenderer.invoke('notifications:dismiss', key),
  listAiAlerts: (): Promise<AiAlertFeed> => ipcRenderer.invoke('ai-alerts:list'),
  refreshAiAlerts: (): Promise<AiAlertFeed> => ipcRenderer.invoke('ai-alerts:refresh'),
  markAiAlertRead: (id: number): Promise<AiAlertFeed> => ipcRenderer.invoke('ai-alerts:read', id),
  dismissAiAlert: (id: number): Promise<AiAlertFeed> => ipcRenderer.invoke('ai-alerts:dismiss', id),
  listUserReminders: (): Promise<Reminder[]> => ipcRenderer.invoke('reminders:list'),
  createUserReminder: (message: string, targetDate: string, repeat: string): Promise<Reminder[]> =>
    ipcRenderer.invoke('reminders:create', message, targetDate, repeat),
  deleteUserReminder: (id: number): Promise<Reminder[]> => ipcRenderer.invoke('reminders:delete', id),

  // memory
  listMemories: (): Promise<Memory[]> => ipcRenderer.invoke('memory:list'),
  createMemory: (content: string, kind: string): Promise<Memory | null> =>
    ipcRenderer.invoke('memory:create', content, kind),
  updateMemory: (
    id: number,
    fields: { content?: string; kind?: string; pinned?: boolean }
  ): Promise<Memory | null> => ipcRenderer.invoke('memory:update', id, fields),
  deleteMemory: (id: number): Promise<boolean> => ipcRenderer.invoke('memory:delete', id),
  searchMemory: (query: string): Promise<MemorySearchResult> => ipcRenderer.invoke('memory:search', query),
  listConversations: (limit?: number): Promise<ConversationEntry[]> =>
    ipcRenderer.invoke('memory:conversations', limit),
  distillMemories: (force?: boolean): Promise<{ added: number }> =>
    ipcRenderer.invoke('memory:distill', force),

  // transactions browser
  searchTransactions: (filter: {
    query?: string
    category?: string
    accountId?: string
    from?: string
    to?: string
    limit?: number
  }): Promise<TransactionSearchResult> => ipcRenderer.invoke('transactions:search', filter),
  importTransactionsCsv: (
    accountName?: string
  ): Promise<{ canceled: boolean; fileName?: string | null } & Partial<TransactionImportResult>> =>
    ipcRenderer.invoke('transactions:import-csv', accountName),

  // subscriptions
  listSubscriptions: (): Promise<{ items: Subscription[]; monthlyTotal: number }> =>
    ipcRenderer.invoke('subscriptions:list'),
  refreshSubscriptions: (): Promise<{ items: Subscription[]; monthlyTotal: number }> =>
    ipcRenderer.invoke('subscriptions:refresh'),
  ignoreSubscription: (key: string): Promise<{ items: Subscription[]; monthlyTotal: number }> =>
    ipcRenderer.invoke('subscriptions:ignore', key),
  unignoreSubscription: (key: string): Promise<{ items: Subscription[]; monthlyTotal: number }> =>
    ipcRenderer.invoke('subscriptions:unignore', key),

  // goals
  listGoals: (): Promise<Goal[]> => ipcRenderer.invoke('goals:list'),
  createGoal: (
    name: string,
    targetAmount: number,
    savedAmount: number,
    targetDate: string | null
  ): Promise<Goal | null> => ipcRenderer.invoke('goals:create', name, targetAmount, savedAmount, targetDate),
  updateGoal: (
    id: number,
    fields: { name?: string; targetAmount?: number; savedAmount?: number; targetDate?: string | null }
  ): Promise<Goal | null> => ipcRenderer.invoke('goals:update', id, fields),
  contributeToGoal: (id: number, amount: number): Promise<Goal | null> =>
    ipcRenderer.invoke('goals:contribute', id, amount),
  deleteGoal: (id: number): Promise<boolean> => ipcRenderer.invoke('goals:delete', id),

  // backups
  listBackups: (): Promise<BackupInfo[]> => ipcRenderer.invoke('backup:list'),
  createBackup: (): Promise<BackupInfo | null> => ipcRenderer.invoke('backup:create'),
  restoreBackup: (fileName: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('backup:restore', fileName),
  exportTransactionsCsv: (): Promise<{ canceled: boolean; path?: string; rows?: number; error?: string }> =>
    ipcRenderer.invoke('backup:export-csv'),

  // dashboard
  getDashboardSummary: (): Promise<DashboardSummary> => ipcRenderer.invoke('dashboard:summary'),

  // health / forecast / reviews
  getHealth: (): Promise<ServiceHealth[]> => ipcRenderer.invoke('health:list'),
  getForecast: (): Promise<ForecastSummary> => ipcRenderer.invoke('forecast:get'),
  listReviews: (limit?: number): Promise<CycleReview[]> => ipcRenderer.invoke('reviews:list', limit),
  latestReview: (): Promise<CycleReview | null> => ipcRenderer.invoke('reviews:latest'),

  // deals
  getDeals: (): Promise<DealsReport> => ipcRenderer.invoke('deals:report'),
  refreshDeals: (): Promise<DealsReport> => ipcRenderer.invoke('deals:refresh'),
  addDealPlan: (input: DealPlanInput): Promise<DealsReport> => ipcRenderer.invoke('deals:add-plan', input),
  deleteDealPlan: (id: number): Promise<DealsReport> => ipcRenderer.invoke('deals:delete-plan', id),
  setPowerUsage: (kwh: number): Promise<DealsReport> => ipcRenderer.invoke('deals:set-usage', kwh),
  openDealCompare: (category: DealCategory): Promise<void> =>
    ipcRenderer.invoke('deals:open-compare', category),

  // ai actions
  listAiActions: (limit?: number): Promise<AiAction[]> => ipcRenderer.invoke('ai:actions', limit),
  undoAiAction: (id: number): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('ai:undo', id),
  runAiEvals: (): Promise<EvalReport> => ipcRenderer.invoke('ai:eval'),
  lastAiEval: (): Promise<EvalReport | null> => ipcRenderer.invoke('ai:eval-last'),
  testAi: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('ai:test'),

  // setup helpers
  getCurrentCycle: (): Promise<{ start: string; end: string; label: string }> =>
    ipcRenderer.invoke('cycle:current'),
  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke('app:launch-at-login'),
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('app:set-launch-at-login', enabled),

  // updates
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
  checkForUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },

  // chat
  getChatHistory: (): Promise<ChatMessage[]> => ipcRenderer.invoke('chat:history'),
  clearChat: (): Promise<void> => ipcRenderer.invoke('chat:clear'),
  sendChat: (message: string): void => ipcRenderer.send('chat:send', message),
  onChatToken: (cb: (token: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, token: string): void => cb(token)
    ipcRenderer.on('chat:token', listener)
    return () => ipcRenderer.removeListener('chat:token', listener)
  },
  onChatReasoning: (cb: (token: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, token: string): void => cb(token)
    ipcRenderer.on('chat:reasoning', listener)
    return () => ipcRenderer.removeListener('chat:reasoning', listener)
  },
  onChatTool: (cb: (payload: { name: string; summary: string; actionId?: number }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { name: string; summary: string; actionId?: number }): void =>
      cb(payload)
    ipcRenderer.on('chat:tool', listener)
    return () => ipcRenderer.removeListener('chat:tool', listener)
  },
  onChatDone: (cb: (full: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, full: string): void => cb(full)
    ipcRenderer.on('chat:done', listener)
    return () => ipcRenderer.removeListener('chat:done', listener)
  },
  onChatError: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, message: string): void => cb(message)
    ipcRenderer.on('chat:error', listener)
    return () => ipcRenderer.removeListener('chat:error', listener)
  },

  // file handling (drag-and-drop -> absolute path)
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
