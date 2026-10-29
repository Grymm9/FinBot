import type {
  Account,
  AlertResult,
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

declare global {
  interface Window {
    api: {
      getSettings: () => Promise<Settings>
      setSetting: (key: string, value: string) => Promise<Settings>
      getMaskedSettings: () => Promise<Settings>

      syncBank: () => Promise<SyncResult>
      getBankStatus: () => Promise<BankStatus>
      listTransactions: (limit?: number) => Promise<Transaction[]>

      listAccounts: () => Promise<Account[]>
      setAccountEnabled: (id: string, enabled: boolean) => Promise<Account[]>

      listRules: () => Promise<CategoryRule[]>
      addRule: (keyword: string, category: string) => Promise<CategoryRule[]>
      removeRule: (id: number) => Promise<CategoryRule[]>
      listUnmatchedMerchants: () => Promise<UnmatchedMerchant[]>
      listCardMappings: () => Promise<CardMapping[]>
      setCardMapping: (card: string, category: string) => Promise<CardMapping[]>
      removeCardMapping: (card: string) => Promise<CardMapping[]>

      listGroups: () => Promise<BudgetGroup[]>
      createGroup: (categories: string[]) => Promise<BudgetGroup[]>
      addDestination: (
        groupId: number,
        fields: {
          amount?: number | null
          accountNumber?: string | null
          accountType?: string | null
          transferLabel?: string | null
        }
      ) => Promise<BudgetGroup[]>
      updateDestination: (
        destId: number,
        fields: {
          amount?: number | null
          accountNumber?: string | null
          accountType?: string | null
          transferLabel?: string | null
        }
      ) => Promise<BudgetGroup[]>
      removeDestination: (destId: number) => Promise<BudgetGroup[]>
      deleteGroup: (id: number) => Promise<BudgetGroup[]>
      removeGroupItem: (groupId: number, category: string) => Promise<BudgetGroup[]>
      addGroupItem: (groupId: number, category: string) => Promise<BudgetGroup[]>

      listCategoryDestinations: () => Promise<CategoryRouting[]>
      addCategoryDestination: (
        category: string,
        fields: {
          amount?: number | null
          accountNumber?: string | null
          accountType?: string | null
          transferLabel?: string | null
        }
      ) => Promise<CategoryRouting[]>
      updateCategoryDestination: (
        destId: number,
        fields: {
          amount?: number | null
          accountNumber?: string | null
          accountType?: string | null
          transferLabel?: string | null
        }
      ) => Promise<CategoryRouting[]>
      removeCategoryDestination: (destId: number) => Promise<CategoryRouting[]>

      listPaymentCandidates: () => Promise<Deduction[]>
      matchPayment: (destinationId: number, transactionId: string, kind: 'group' | 'category') => Promise<MatchedPayment[]>
      unmatchPayment: (destinationId: number, kind: 'group' | 'category') => Promise<MatchedPayment[]>

      listManualAssets: () => Promise<ManualAsset[]>
      addManualAsset: (name: string, amount: number) => Promise<ManualAsset[]>
      updateManualAsset: (id: number, fields: { name?: string; amount?: number }) => Promise<ManualAsset[]>
      removeManualAsset: (id: number) => Promise<ManualAsset[]>

      importBudgetCsv: () => Promise<{ canceled: boolean } & Partial<BudgetImportResult>>
      importBudgetImage: (filePath: string) => Promise<BudgetImportResult>
      importBudgetImageDialog: () => Promise<{ canceled: boolean } & Partial<BudgetImportResult>>
      listCategories: () => Promise<Category[]>
      setCategoryBudget: (name: string, amount: number, frequency?: string) => Promise<Category[]>
      setCategorySplit: (name: string, split: boolean) => Promise<Category[]>
      setCategoryActiveFrom: (name: string, date: string) => Promise<Category[]>
      deleteCategory: (name: string) => Promise<Category[]>
      clearCategories: () => Promise<Category[]>

      importInsurancePdf: (filePath: string) => Promise<InsurancePolicy>
      importInsurancePdfs: (filePaths: string[]) => Promise<{ imported: number; policies: InsurancePolicy[] }>
      importInsurancePdfDialog: () => Promise<{ canceled: boolean; imported?: number; policies?: InsurancePolicy[] }>
      listPolicies: () => Promise<InsurancePolicy[]>
      updatePolicy: (
        id: number,
        fields: { provider?: string; coverType?: string; premium?: number; frequency?: string; renewalDate?: string }
      ) => Promise<InsurancePolicy>
      deletePolicy: (id: number) => Promise<void>
      linkPolicies: () => Promise<{ linked: number }>
      createPolicy: (fields: {
        provider?: string | null
        coverType?: string | null
        premium?: number | null
        frequency?: string | null
        renewalDate?: string | null
        sourceFile?: string | null
      }) => Promise<InsurancePolicy>
      storePdfDialog: () => Promise<{ canceled: boolean; name?: string }>
      attachPdfDialog: (id: number) => Promise<{ canceled: boolean; policy?: InsurancePolicy }>
      openPolicyFile: (id: number) => Promise<{ ok: boolean; error?: string }>
      linkPolicyToTransaction: (policyId: number, transactionId: string) => Promise<InsurancePolicy>
      unlinkPolicy: (policyId: number) => Promise<InsurancePolicy>
      listDeductions: () => Promise<Deduction[]>
      listBundles: () => Promise<InsuranceBundle[]>
      createBundle: (name: string | null, policyIds: number[]) => Promise<InsuranceBundle[]>
      addBundleItem: (bundleId: number, policyId: number) => Promise<InsuranceBundle[]>
      removeBundleItem: (bundleId: number, policyId: number) => Promise<InsuranceBundle[]>
      deleteBundle: (bundleId: number) => Promise<InsuranceBundle[]>
      renameBundle: (bundleId: number, name: string) => Promise<InsuranceBundle[]>
      linkBundleToTransaction: (bundleId: number, transactionId: string) => Promise<InsuranceBundle[]>
      unlinkBundle: (bundleId: number) => Promise<InsuranceBundle[]>
      attachBundlePdfDialog: (bundleId: number) => Promise<{ canceled: boolean; bundles?: InsuranceBundle[] }>
      openBundleFile: (bundleId: number) => Promise<{ ok: boolean; error?: string }>

      testDiscord: () => Promise<{ ok: boolean; message: string }>
      notifyUncategorized: () => Promise<{ count: number }>
      checkDiscordReplies: () => Promise<{ processed: number; replied: number; error?: string }>
      scanEmails: () => Promise<EmailScanResult>
      listEmails: () => Promise<EmailRecord[]>
      setEmailRelevant: (id: number, relevant: boolean) => Promise<EmailRecord[]>
      runBudgetCheck: () => Promise<AlertResult>
      previewAlerts: () => Promise<{ flags: AlertResult['flags'] }>
      dismissAlert: (key: string) => Promise<void>
      listAiAlerts: () => Promise<AiAlertFeed>
      refreshAiAlerts: () => Promise<AiAlertFeed>
      markAiAlertRead: (id: number) => Promise<AiAlertFeed>
      dismissAiAlert: (id: number) => Promise<AiAlertFeed>
      listUserReminders: () => Promise<Reminder[]>
      createUserReminder: (message: string, targetDate: string, repeat: string) => Promise<Reminder[]>
      deleteUserReminder: (id: number) => Promise<Reminder[]>

      listMemories: () => Promise<Memory[]>
      createMemory: (content: string, kind: string) => Promise<Memory | null>
      updateMemory: (
        id: number,
        fields: { content?: string; kind?: string; pinned?: boolean }
      ) => Promise<Memory | null>
      deleteMemory: (id: number) => Promise<boolean>
      searchMemory: (query: string) => Promise<MemorySearchResult>
      listConversations: (limit?: number) => Promise<ConversationEntry[]>
      distillMemories: (force?: boolean) => Promise<{ added: number }>

      searchTransactions: (filter: {
        query?: string
        category?: string
        accountId?: string
        from?: string
        to?: string
        limit?: number
      }) => Promise<TransactionSearchResult>
      importTransactionsCsv: (
        accountName?: string
      ) => Promise<{ canceled: boolean; fileName?: string | null } & Partial<TransactionImportResult>>

      listSubscriptions: () => Promise<{ items: Subscription[]; monthlyTotal: number }>
      refreshSubscriptions: () => Promise<{ items: Subscription[]; monthlyTotal: number }>
      ignoreSubscription: (key: string) => Promise<{ items: Subscription[]; monthlyTotal: number }>
      unignoreSubscription: (key: string) => Promise<{ items: Subscription[]; monthlyTotal: number }>

      listGoals: () => Promise<Goal[]>
      createGoal: (
        name: string,
        targetAmount: number,
        savedAmount: number,
        targetDate: string | null
      ) => Promise<Goal | null>
      updateGoal: (
        id: number,
        fields: { name?: string; targetAmount?: number; savedAmount?: number; targetDate?: string | null }
      ) => Promise<Goal | null>
      contributeToGoal: (id: number, amount: number) => Promise<Goal | null>
      deleteGoal: (id: number) => Promise<boolean>

      listBackups: () => Promise<BackupInfo[]>
      createBackup: () => Promise<BackupInfo | null>
      restoreBackup: (fileName: string) => Promise<{ ok: boolean; error?: string }>
      exportTransactionsCsv: () => Promise<{ canceled: boolean; path?: string; rows?: number; error?: string }>

      getDashboardSummary: () => Promise<DashboardSummary>

      getHealth: () => Promise<ServiceHealth[]>
      getForecast: () => Promise<ForecastSummary>
      listReviews: (limit?: number) => Promise<CycleReview[]>
      latestReview: () => Promise<CycleReview | null>

      getDeals: () => Promise<DealsReport>
      refreshDeals: () => Promise<DealsReport>
      addDealPlan: (input: DealPlanInput) => Promise<DealsReport>
      deleteDealPlan: (id: number) => Promise<DealsReport>
      setPowerUsage: (kwh: number) => Promise<DealsReport>
      openDealCompare: (category: DealCategory) => Promise<void>

      listAiActions: (limit?: number) => Promise<AiAction[]>
      undoAiAction: (id: number) => Promise<{ ok: boolean; message: string }>
      runAiEvals: () => Promise<EvalReport>
      lastAiEval: () => Promise<EvalReport | null>
      testAi: () => Promise<{ ok: boolean; message: string }>

      getCurrentCycle: () => Promise<{ start: string; end: string; label: string }>
      getLaunchAtLogin: () => Promise<boolean>
      setLaunchAtLogin: (enabled: boolean) => Promise<boolean>

      getUpdateStatus: () => Promise<UpdateStatus>
      checkForUpdate: () => Promise<UpdateStatus>
      installUpdate: () => Promise<UpdateStatus>
      onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void

      getChatHistory: () => Promise<ChatMessage[]>
      clearChat: () => Promise<void>
      sendChat: (message: string) => void
      onChatToken: (cb: (token: string) => void) => () => void
      onChatReasoning: (cb: (token: string) => void) => () => void
      onChatTool: (cb: (payload: { name: string; summary: string; actionId?: number }) => void) => () => void
      onChatDone: (cb: (full: string) => void) => () => void
      onChatError: (cb: (message: string) => void) => () => void
      getPathForFile: (file: File) => string
    }
  }
}

export {}
