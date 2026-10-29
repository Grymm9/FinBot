import { getDb } from '../db'
import { getSetting, getSettingNumber, setSetting } from './settings'
import { computeBudgetStatus } from './budget'
import { currentCycleRange } from './cycle'
import { sendDiscordMessage } from './discord'
import { checkExpectedPayments } from './payments'
import { daysIn, daysInto, paceRatio, projectedSpend } from './reconcile-math'
import { todayLocalIso } from './dates'
import { detectInsights } from './insights'
import { persistCycleHistory } from './history'
import { refreshSubscriptions } from './subscriptions'
import { refreshAiAlerts } from './ai-alerts'
import { refreshReviews } from './reviews'
import { notifyInsuranceReviews } from './deals'
import { track } from './health'
import { syncIfStale } from './sync-scheduler'
import type { AlertResult } from '@shared/types'

/**
 * Evaluate budget pacing for the current income cycle.
 *
 * For every category with a budget, we project cycle-end spend from the
 * current spend rate and flag categories that are on track to blow their
 * budget before the next payday.
 */
export function evaluateBudget(): AlertResult['flags'] {
  const cycle = currentCycleRange()
  const status = computeBudgetStatus(cycle.start, cycle.end)
  const elapsed = daysInto(cycle.start, todayLocalIso())
  const total = daysIn(cycle.start, cycle.end)

  return status
    .filter((c) => c.budgeted > 0 && c.spent > 0)
    .map((c) => {
      const projected = projectedSpend(c.spent, elapsed, total)
      const ratio = paceRatio(projected, c.budgeted)
      return {
        category: c.category,
        budgeted: c.budgeted,
        spent: c.spent,
        projected: Math.round(projected * 100) / 100,
        ratio: Math.round(ratio * 100) / 100
      }
    })
    .filter((f) => f.ratio > getSettingNumber('ALERT_SPEND_RATIO', 0.8))
    .sort((a, b) => b.ratio - a.ratio)
}

/**
 * Run a full budget check. If any category is pacing too fast, fire a
 * Discord webhook (when configured). Returns a result for the UI.
 */
export async function checkAndAlert(): Promise<AlertResult> {
  const flags = evaluateBudget()
  const cycle = currentCycleRange()
  const webhookConfigured = !!getSetting('DISCORD_WEBHOOK_URL')

  let message: string
  let fired = false

  if (flags.length === 0) {
    message = `Budget is on track for this cycle (${cycle.label}).`
  } else {
    const list = flags
      .map(
        (f) =>
          `• **${f.category}**: $${f.spent} spent, on track for $${f.projected} vs $${f.budgeted} budget (${Math.round(f.ratio * 100)}%)`
      )
      .join('\n')
    message = `⚠️ **Overspend risk** (cycle starting ${cycle.label}):\n${list}\n\nConsider rebalancing before your next payday.`

    if (webhookConfigured) {
      try {
        const r = await sendDiscordMessage(message)
        fired = r.ok
      } catch (e) {
        console.error('Discord alert failed:', e)
        fired = false
      }
    }
  }

  return {
    fired,
    checked: true,
    message,
    flags,
    checkedDay: new Date().getDate(),
    budgetCheckDay: getSettingNumber('INCOME_CYCLE_DAY', 15),
    webhookConfigured
  }
}

/**
 * Background scheduler. Syncs stale bank data first (so alerts are never based
 * on old transactions), closes out finished cycles, refreshes subscription
 * detection, then evaluates alerts. Runs on startup and every 6 hours.
 */
export function startScheduler(): NodeJS.Timeout {
  const run = async (): Promise<void> => {
    const result = await track('alerts', async () => {
      await syncIfStale(30)
      persistCycleHistory()
      refreshSubscriptions()
      refreshAiAlerts()
      const alert = await checkAndAlert()
      if (alert.fired) logAlert(alert.message)
      await notifyMissedPayments()
      await notifyInsights()
      await notifyReviews()
      await notifyInsuranceReviews()
      return true
    })
    if (result === null) console.error('Scheduled budget check failed — see Settings → Service health.')
  }

  // First check shortly after launch.
  setTimeout(run, 10_000)
  const interval = setInterval(run, 6 * 60 * 60 * 1000)
  return interval
}

/**
 * Post one Discord message for newly-detected insights (large spend, low
 * balance, subscription price rise, insurance renewal). Each insight is only
 * announced once — `notified_alerts` dedupes across scheduler runs.
 */
async function notifyInsights(): Promise<void> {
  const insights = detectInsights()
  if (insights.length === 0) return

  const db = getDb()
  const already = db.prepare('SELECT 1 AS x FROM notified_alerts WHERE alert_key = ?')
  const mark = db.prepare('INSERT OR IGNORE INTO notified_alerts (alert_key, sent_at) VALUES (?, ?)')

  const fresh = insights.filter((i) => !already.get(i.key))
  if (fresh.length === 0) return

  const icon = (s: string): string => (s === 'bad' ? '🔴' : s === 'warn' ? '🟠' : '🔵')
  const lines = fresh.map((i) => `${icon(i.severity)} **${i.title}**\n${i.detail}`).join('\n\n')
  try {
    const r = await sendDiscordMessage(`🔎 **FinanceBot notices**\n\n${lines}`)
    if (r.ok) for (const i of fresh) mark.run(i.key, Date.now())
  } catch (e) {
    console.error('Insight alert failed:', e)
  }
}

/** Post the newest cycle review to Discord once per cycle. */
async function notifyReviews(): Promise<void> {
  const created = refreshReviews(6)
  if (created.length === 0) return
  const db = getDb()
  const mark = db.prepare('INSERT OR IGNORE INTO notified_alerts (alert_key, sent_at) VALUES (?, ?)')
  const already = db.prepare('SELECT 1 AS x FROM notified_alerts WHERE alert_key = ?')

  // created[0] is the newest closed cycle. Older reviews generated on the first
  // run are recorded silently so an upgrade doesn't blast six messages.
  const newest = created[0]
  const key = `review:${newest.cycleStart}`
  if (!already.get(key)) {
    const body = newest.body
      .split('\n')
      .map((l) => `• ${l}`)
      .join('\n')
    try {
      const r = await sendDiscordMessage(`📊 **Cycle review — ${newest.label}**\n**${newest.headline}**\n${body}`)
      if (r.ok) mark.run(key, Date.now())
    } catch (e) {
      console.error('Cycle review post failed:', e)
    }
  }
  for (const r of created) mark.run(`review:${r.cycleStart}`, Date.now())
}

/** Fire a Discord alert for routed groups whose transfer wasn't detected this cycle. */
async function notifyMissedPayments(): Promise<void> {
  const missed = checkExpectedPayments()
  if (missed.length === 0) return
  const cycle = currentCycleRange()
  if (getSetting('missed_alert_cycle') === cycle.start) return // already alerted this cycle

  const lines = missed
    .map((m) => `• **${m.label}**: $${m.amount}${m.accountNumber ? ' → ' + m.accountNumber : ''}`)
    .join('\n')
  try {
    const r = await sendDiscordMessage(`⚠️ **Missed expected payment(s)** this cycle:\n${lines}`)
    if (r.ok) setSetting('missed_alert_cycle', cycle.start)
  } catch (e) {
    console.error('Missed payment alert failed:', e)
  }
}

function logAlert(message: string): void {
  try {
    getDb()
      .prepare('INSERT INTO alert_log (type, message, sent_at, success) VALUES (?, ?, ?, ?)')
      .run('budget', message, Date.now(), 1)
  } catch {
    // best-effort
  }
}
