import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import { getDb, closeDb } from './db'
import { registerIpcHandlers } from './ipc'
import { startScheduler } from './services/alerts'
import { startReminderScheduler } from './services/reminders'
import { startDiscordScheduler } from './services/discord-resolution'
import { startEmailScheduler } from './services/email'
import { startMemoryScheduler } from './services/memory'
import { startSyncScheduler } from './services/sync-scheduler'
import { startBackupScheduler } from './services/backup'
import { startUpdateScheduler } from './services/updater'
import { startDealScheduler, getDealsReport, refreshDealPrices } from './services/deals'
import { runAiEvals } from './services/ai-eval'
import { migrateSecrets } from './services/settings'
import { getSetting, setSetting } from './services/settings'
import { persistCycleHistory } from './services/history'
import { buildCashFlowForecast } from './services/forecast'
import { listGroups, listCategoryDestinations } from './services/groups'
import { refreshReviews, listReviews } from './services/reviews'
import { getHealth } from './services/health'
import { computeBudgetStatus } from './services/budget'
import { currentCycleRange } from './services/cycle'
import { refreshAiAlerts } from './services/ai-alerts'
import { executeTool } from './services/tools'
import { undoAction } from './services/ai-actions'

// Load .env from the project root so secrets are available in the main process.
loadEnv({ path: resolve(process.cwd(), '.env') })

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#07090f',
    title: 'FinanceBot',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

interface AuditStep {
  step: string
  ok: boolean
  detail: string
}

/**
 * Existing installs predate the setup wizard, so opening 0.4.0 for the first
 * time must not dump a long-time user into a first-run flow. If the database
 * already has data (or credentials came from `.env`), mark onboarding complete
 * silently. A genuinely fresh database is left for the wizard.
 */
function completeOnboardingForExistingInstall(): void {
  if (getSetting('ONBOARDING_COMPLETED')) return
  const db = getDb()
  const alreadyUsed =
    (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n > 0 ||
    (db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n > 0 ||
    (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n > 0 ||
    (db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key NOT LIKE 'ONBOARDING%'").get() as { n: number }).n > 0 ||
    !!process.env.AKAHU_APP_TOKEN ||
    !!process.env.DEEPSEEK_API_KEY ||
    !!process.env.AI_API_KEY
  if (alreadyUsed) {
    setSetting('ONBOARDING_COMPLETED', '1')
    setSetting('ONBOARDING_STEP', '')
    console.log('Existing install detected: setup assistant will not run.')
  }
}

/**
 * Round-trip check for the AI write audit trail (`--self-test-audit`).
 *
 * Creates a throwaway budget category and memory through the same tools the
 * model calls, undoes each change, and verifies the data is back to where it
 * started. Nothing real is touched, and the audit rows are removed afterwards.
 */
async function selfTestAudit(): Promise<{ ok: boolean; steps: AuditStep[] }> {
  const db = getDb()
  const category = 'FinanceBot Audit Test'
  const memoryText = `FinanceBot audit self-test ${Date.now()}`
  const steps: AuditStep[] = []
  const add = (step: string, ok: boolean, detail: string): void => {
    steps.push({ step, ok, detail })
  }
  const categoryAmount = (): number | undefined =>
    (db.prepare('SELECT amount FROM categories WHERE name = ?').get(category) as { amount: number } | undefined)
      ?.amount
  const actionIds: number[] = []

  // Never leave a previous failed run behind.
  db.prepare('DELETE FROM categories WHERE name = ?').run(category)

  const created = await executeTool('add_budget_line_item', { name: category, amount: 10, frequency: 'monthly' })
  if (created.actionId) actionIds.push(created.actionId)
  add('create category', categoryAmount() === 10 && !!created.actionId, created.summary)

  const updated = await executeTool('update_budget_allocation', {
    category,
    amount: 25,
    frequency: 'monthly'
  })
  if (updated.actionId) actionIds.push(updated.actionId)
  add('update category', categoryAmount() === 25 && !!updated.actionId, updated.summary)

  const undoUpdate = updated.actionId ? undoAction(updated.actionId) : { ok: false, message: 'no action id' }
  add('undo update', undoUpdate.ok && categoryAmount() === 10, undoUpdate.message)

  const undoCreate = created.actionId ? undoAction(created.actionId) : { ok: false, message: 'no action id' }
  add('undo create', undoCreate.ok && categoryAmount() === undefined, undoCreate.message)

  const saved = await executeTool('save_memory', { content: memoryText, kind: 'fact' })
  if (saved.actionId) actionIds.push(saved.actionId)
  const memoryRow = db.prepare('SELECT id FROM memories WHERE content = ?').get(memoryText) as
    | { id: number }
    | undefined
  add('save memory', !!memoryRow && !!saved.actionId, saved.summary)

  const undoMemory = saved.actionId ? undoAction(saved.actionId) : { ok: false, message: 'no action id' }
  const memoryGone = !db.prepare('SELECT 1 AS x FROM memories WHERE content = ?').get(memoryText)
  add('undo memory', undoMemory.ok && memoryGone, undoMemory.message)

  // Leave no trace in the user's audit list or budget.
  for (const id of actionIds) db.prepare('DELETE FROM ai_actions WHERE id = ?').run(id)
  db.prepare('DELETE FROM categories WHERE name = ?').run(category)
  db.prepare('DELETE FROM memories WHERE content = ?').run(memoryText)

  return { ok: steps.every((s) => s.ok), steps }
}

// A second copy of the app would start a second set of schedulers (duplicate
// Discord replies, duplicate reminders). Only one instance may run.
const RUN_EVALS = process.argv.includes('--run-evals')
const PRINT_FORECAST = process.argv.includes('--print-forecast')
const PRINT_DEALS = process.argv.includes('--print-deals')
const REFRESH_DEALS = process.argv.includes('--refresh-deals')
const SELF_TEST_AUDIT = process.argv.includes('--self-test-audit')
const PRINT_AI_ALERTS = process.argv.includes('--print-ai-alerts')
const gotLock = RUN_EVALS || PRINT_FORECAST || PRINT_DEALS || REFRESH_DEALS || SELF_TEST_AUDIT || PRINT_AI_ALERTS ? true : app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // Initialise the DB (schema + migration) before anything else touches it.
    getDb()
    migrateSecrets()
    completeOnboardingForExistingInstall()
    persistCycleHistory()
    app.setAppUserModelId('nz.financebot.app')

    // Headless AI regression run: `financebot --run-evals`.
    if (RUN_EVALS) {
      const report = await runAiEvals()
      console.log(JSON.stringify(report, null, 2))
      app.exit(report.passed === report.total ? 0 : 1)
      return
    }

    // Headless forecast dump, used to sanity-check the numbers: `--print-forecast`.
    if (PRINT_FORECAST) {
      const cycle = currentCycleRange()
      const hadReviews = listReviews(1).length > 0
      const created = refreshReviews(6)
      const readBack = listReviews(6)
      // On a fresh install, leave the reviews table empty so the real scheduler
      // run still announces the newest review on Discord.
      if (!hadReviews) getDb().prepare('DELETE FROM reviews').run()
      const output = {
        cycle,
        groups: listGroups(),
        categoryDestinations: listCategoryDestinations(),
        budget: computeBudgetStatus(cycle.start, cycle.end).map((c) => ({
          category: c.category,
          budgeted: c.budgeted,
          spent: c.spent
        })),
        forecast: buildCashFlowForecast(),
        reviewsCreated: created,
        reviewsReadBack: readBack,
        health: getHealth()
      }
      console.log(JSON.stringify(output, null, 2))
      app.exit(0)
      return
    }

    // Headless deal catalogue dump: `--print-deals`, or re-fetch the retailer
    // pages first with `--refresh-deals`.
    if (PRINT_DEALS || REFRESH_DEALS) {
      const report = REFRESH_DEALS ? await refreshDealPrices() : getDealsReport()
      process.stdout.write(JSON.stringify(report, null, 2) + '\n', () => app.exit(0))
      return
    }

    // End-to-end check of the AI write audit trail and undo: creates a
    // throwaway category and memory, undoes both, then cleans up.
    if (SELF_TEST_AUDIT) {
      const result = await selfTestAudit()
      console.log(JSON.stringify(result, null, 2))
      app.exit(result.ok ? 0 : 1)
      return
    }

    // Headless AI insight dump: `--print-ai-alerts`.
    if (PRINT_AI_ALERTS) {
      const feed = refreshAiAlerts()
      console.log(JSON.stringify(feed, null, 2))
      app.exit(0)
      return
    }

    registerIpcHandlers()
    startScheduler()
    startReminderScheduler()
    startDiscordScheduler()
    startEmailScheduler()
    startMemoryScheduler()
    startSyncScheduler()
    startBackupScheduler()
    startUpdateScheduler()
    startDealScheduler()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    closeDb()
  })
}
