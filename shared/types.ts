// Shared TypeScript types used by both the Electron main process and the renderer.

export interface Account {
  id: string
  name: string
  type: string | null
  connectionId: string | null
  status: string | null
  currency: string
  enabled: boolean
}

export interface CategoryRule {
  id: number
  keyword: string
  category: string
}

export interface UnmatchedMerchant {
  key: string
  label: string
  count: number
  total: number
}

export interface MissedPayment {
  kind: 'group' | 'category'
  groupId: number
  destinationId: number
  label: string
  amount: number
  accountNumber: string | null
  items: string[]
  key: string
}

export interface MatchedPayment {
  kind: 'group' | 'category'
  destinationId: number
  label: string
  amount: number
  accountNumber: string | null
  transactionId: string
  transactionDate: string
  transactionDescription: string
  transactionAmount: number
}

export interface ManualAsset {
  id: number
  name: string
  amount: number
}

export interface EmailMatch {
  subject: string
  from: string
  date: string
  snippet: string
  keywords: string[]
}

export interface Reminder {
  id: number
  message: string
  targetDate: string
  repeat: string
}

export interface EmailScanResult {
  matches: EmailMatch[]
  policyCount?: number
  error?: string
}

export interface EmailRecord {
  id: number
  subject: string
  from: string
  date: string
  snippet: string
  keywords: string[]
  relevant: boolean
}

export interface Deduction {
  id: string
  date: string
  description: string
  amount: number
  account: string
}

export interface CardMapping {
  card: string
  category: string
}

export interface DuplicateCharge {
  merchant: string
  amount: number
  count: number
  firstDate: string
  lastDate: string
  transactionIds: string[]
  key: string
}

export interface BalanceInfo {
  account: string
  current: number
  available: number
  enabled: boolean
}

export interface BudgetGroupItem {
  category: string
  amount: number
}

export interface BudgetGroupDestination {
  id: number
  amount: number | null
  accountNumber: string | null
  accountType: string | null
  transferLabel: string | null
}

export interface CategoryDestination {
  id: number
  amount: number | null
  accountNumber: string | null
  accountType: string | null
  transferLabel: string | null
}

export interface CategoryRouting {
  category: string
  destinations: CategoryDestination[]
}

export interface BudgetGroup {
  id: number
  items: BudgetGroupItem[]
  sum: number
  destinations: BudgetGroupDestination[]
}

export interface Transaction {
  id: string
  accountId: string | null
  date: string // YYYY-MM-DD
  description: string
  amount: number // signed: positive = credit, negative = debit
  type: string | null
  category: string | null
  merchant: string | null
}

export interface TransactionRow extends Transaction {
  accountName: string
  matchedCategory: string | null
}

export interface TransactionSearchResult {
  rows: TransactionRow[]
  count: number
  totalDebit: number
  totalCredit: number
}

/** Result of importing a bank-statement CSV (the Akahu-free path). */
export interface TransactionImportResult {
  imported: number
  /** Rows that could not be parsed plus rows that were already imported. */
  skipped: number
  dateFrom: string | null
  dateTo: string | null
  accountNames: string[]
  skippedSample: string[]
  columns: {
    date: string | null
    description: string | null
    amount: string | null
    account: string | null
  }
}

export interface BackupInfo {
  fileName: string
  path: string
  createdAt: number
  sizeBytes: number
}

export interface Subscription {
  id: number
  key: string
  merchant: string
  amount: number
  previousAmount: number | null
  cadence: string
  monthlyAmount: number
  lastDate: string
  occurrences: number
  confidence: number
  priceRose: boolean
}

export interface Goal {
  id: number
  name: string
  targetAmount: number
  savedAmount: number
  targetDate: string | null
  createdAt: number
  updatedAt: number
}

export type InsightType = 'low_balance' | 'large_transaction' | 'subscription_rise' | 'insurance_renewal'

export interface Insight {
  key: string
  type: InsightType
  severity: 'info' | 'warn' | 'bad'
  title: string
  detail: string
  amount?: number
  date?: string
}

// ------------------------------------------------------------------ ai alerts

export type AiAlertKind = 'subscription_increase' | 'spending_velocity'

/**
 * A persisted AI insight shown on the Dashboard panel. Alerts are deduped by a
 * stable key so a scheduler re-run never creates the same card twice.
 */
export interface AiAlert {
  id: number
  kind: AiAlertKind
  severity: Insight['severity']
  title: string
  body: string
  merchant: string | null
  category: string | null
  amount: number | null
  previousAmount: number | null
  cycleStart: string | null
  createdAt: number
  updatedAt: number
  readAt: number | null
}

export interface AiAlertFeed {
  alerts: AiAlert[]
  unread: number
}

export interface CycleHistoryEntry {
  cycleStart: string
  cycleEnd: string
  label: string
  income: number
  expense: number
  net: number
}

export interface Category {
  name: string
  amount: number // amount per period
  frequency: string // 'monthly' | 'fortnightly' | 'weekly'
  color: string | null
  split: boolean
  activeFrom: string | null
}

export interface BudgetImportResult {
  imported: number
  skipped: number
  skippedSample: string[]
  categories: Category[]
  ocrText?: string
}

export interface BudgetStatus {
  category: string
  budgeted: number
  spent: number
  remaining: number
  percent: number // spent / budgeted * 100
}

export interface CashFlowPoint {
  label: string // e.g. "15 Oct"
  income: number
  expense: number
}

export interface InsurancePolicy {
  id: number
  provider: string | null
  coverType: string | null
  premium: number | null
  frequency: string | null
  renewalDate: string | null
  sourceFile: string | null
  linkedTransactionId: string | null
  extracted: boolean
  extractionError?: string | null
}

export interface InsuranceBundleItem {
  policyId: number
  provider: string | null
  coverType: string | null
  premium: number | null
  frequency: string | null
  monthly: number
  sourceFile: string | null
}

export interface InsuranceBundle {
  id: number
  name: string | null
  linkedTransactionId: string | null
  sourceFile: string | null
  items: InsuranceBundleItem[]
  monthlyTotal: number
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  channel?: 'app' | 'discord'
}

export type MemoryKind = 'fact' | 'preference' | 'note' | 'summary'

export interface Memory {
  id: number
  kind: MemoryKind
  content: string
  source: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface ConversationEntry {
  id: number
  channel: 'app' | 'discord'
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export interface MemorySearchResult {
  memories: Memory[]
  conversations: ConversationEntry[]
}

export interface DashboardSummary {
  accounts: Account[]
  totalBudgeted: number
  totalSpent: number
  totalRemaining: number
  categories: BudgetStatus[]
  cashFlow: CashFlowPoint[]
  recentTransactions: Transaction[]
  missedPayments: MissedPayment[]
  matchedPayments: MatchedPayment[]
  duplicateCharges: DuplicateCharge[]
  insights: Insight[]
  balances: BalanceInfo[]
  manualAssets: ManualAsset[]
  cycleLabel: string
  cycleRange: string
  timeZone: string
  health: ServiceHealth[]
  forecast: ForecastSummary
  review: CycleReview | null
  aiAlerts: AiAlert[]
  aiUnread: number
}

export interface SyncResult {
  accounts: number
  balances: number
  transactions: number
}

export interface AlertResult {
  fired: boolean
  checked: boolean
  message: string
  flags: Array<{ category: string; budgeted: number; spent: number; projected: number; ratio: number }>
  checkedDay: number
  budgetCheckDay: number
  webhookConfigured: boolean
}

export interface Settings {
  [key: string]: string
}

export interface BankStatus {
  accounts: number
  transactions: number
  lastSync: string | null
}

// ---------------------------------------------------------------- service health

export type HealthStatus = 'ok' | 'warn' | 'fail' | 'unknown'

export interface ServiceHealth {
  service: string
  label: string
  status: HealthStatus
  lastOk: number | null
  lastError: string | null
  lastErrorAt: number | null
  failures: number
  /** False when the integration has no credentials yet (user skipped setup). */
  configured: boolean
}

// -------------------------------------------------------------------- forecast

export type ForecastKind = 'income' | 'committed' | 'subscription' | 'budget'

export interface ForecastEvent {
  date: string
  label: string
  amount: number // signed: positive = money in, negative = money out
  kind: ForecastKind
  estimated?: boolean
}

export interface ForecastPoint {
  date: string
  balance: number
}

export interface ForecastSummary {
  startDate: string
  endDate: string
  startBalance: number
  projectedEnd: number
  minBalance: number
  minDate: string
  income: number
  committed: number
  subscriptions: number
  discretionary: number
  dailyBurn: number
  points: ForecastPoint[]
  events: ForecastEvent[]
  warnings: string[]
}

// --------------------------------------------------------------------- reviews

export interface CycleReview {
  cycleStart: string
  label: string
  headline: string
  body: string
  metrics: Record<string, number>
  createdAt: number
}

// ------------------------------------------------------------------ ai actions

export interface AiAction {
  id: number
  tool: string
  summary: string
  args: Record<string, unknown>
  undone: boolean
  createdAt: number
}

// --------------------------------------------------------------------- updates

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion?: string
  progress?: number
  message?: string
  notes?: string
  checkedAt?: number
}

// ------------------------------------------------------------------ ai evals

export interface EvalCaseResult {
  id: string
  prompt: string
  ok: boolean
  detail: string
  tool?: string
  ms: number
}

export interface EvalReport {
  ranAt: number
  passed: number
  total: number
  cases: EvalCaseResult[]
}

// ---------------------------------------------------------------------- deals

/** The three recurring household bills that can be compared on price. */
export type DealCategory = 'power' | 'broadband' | 'mobile'

/**
 * One published plan in the local catalogue. Fixed-price plans (broadband,
 * mobile) use `monthlyPrice`; power plans are modelled as a daily fixed charge
 * plus a per-kWh rate so they can be priced against real usage.
 */
export interface DealPlan {
  id: number
  category: DealCategory
  provider: string
  planName: string
  monthlyPrice: number | null
  /** Power only: dollars per kWh, GST inclusive. */
  variableRate: number | null
  /** Power only: dollars per day, GST inclusive. */
  dailyCharge: number | null
  /** Power only: lines network the rates apply to, e.g. `orion`. */
  region: string | null
  sourceUrl: string | null
  verifiedAt: number | null
  /** Set when a refresh could no longer find the recorded price on the page. */
  stale: boolean
  notes: string | null
}

/** A plan entered by the user, e.g. from a recent bill or a retailer's page. */
export interface DealPlanInput {
  category: DealCategory
  provider: string
  planName: string
  monthlyPrice?: number | null
  variableRate?: number | null
  dailyCharge?: number | null
  region?: string | null
  sourceUrl?: string | null
  notes?: string | null
}

export interface DealOffer {
  plan: DealPlan
  monthlyCost: number
  /** Positive means cheaper than what you pay now. */
  monthlySaving: number
  annualSaving: number
  /** The plan you appear to be on today. */
  isCurrent: boolean
}

export interface DealComparison {
  category: DealCategory
  label: string
  currentProvider: string | null
  currentMonthly: number | null
  /** Power only: monthly kWh used for pricing. */
  usageKwh: number | null
  offers: DealOffer[]
  bestSaveMonthly: number
  bestSaveAnnual: number
  lastChecked: number | null
  staleCount: number
  /** Shown when the data can't support a like-for-like comparison. */
  note: string | null
}

export interface RenewalReview {
  policyId: number
  provider: string | null
  coverType: string | null
  renewalDate: string
  daysAway: number
  premium: number | null
  frequency: string | null
}

export interface DealsReport {
  comparisons: DealComparison[]
  renewals: RenewalReview[]
  lastChecked: number | null
  powerUsageKwh: number
}
