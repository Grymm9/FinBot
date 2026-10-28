import { getDb } from '../db'
import { streamChat, baseSystemPrompt } from './deepseek'
import { setToolsReadOnly } from './tools'
import { buildFinancialContext } from './context'
import { memoryBlock } from './memory'
import { listCategories, computeBudgetStatus } from './budget'
import { currentCycleRange } from './cycle'
import { listSubscriptions } from './subscriptions'
import { listGoals } from './goals'
import { buildCashFlowForecast } from './forecast'
import { money } from './forecast-math'
import type { EvalCaseResult, EvalReport } from '@shared/types'

/**
 * AI regression suite.
 *
 * The money engine has unit tests; the model layer — the only part that can
 * write to the budget — had none. These cases run through the real chat
 * pipeline (same system prompt, same context, same tools) against the live
 * database and assert the answer matches the data. Expectations are computed
 * at run time, so the suite doesn't rot as your numbers change.
 *
 * Run with `npm run eval:ai` (headless) or Settings → "Run AI self-test".
 * Read-only prompts only: a self-test must never mutate real money data.
 */

interface EvalCase {
  id: string
  prompt: string
  expect: {
    contains?: string[]
    tool?: string
    matches?: RegExp
  }
}

function variants(amount: number): string[] {
  const abs = Math.abs(amount)
  const plain = abs.toFixed(2)
  const noDecimals = String(Math.round(abs))
  const withCommas = abs.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return [plain, noDecimals, withCommas, money(amount).replace('$', '')]
}

function buildCases(): EvalCase[] {
  const status = computeBudgetStatus(currentCycleRange().start, currentCycleRange().end)
  const totalBudgeted = status.reduce((s, c) => s + c.budgeted, 0)
  const topCategory = [...status].sort((a, b) => b.budgeted - a.budgeted)[0]
  const cycle = currentCycleRange()
  const subs = listSubscriptions()
  const goals = listGoals()
  const forecast = buildCashFlowForecast()
  const cards = listCategories().length

  const cases: EvalCase[] = [
    {
      id: 'budget-total',
      prompt: 'What is my total budget for this cycle? Reply with just the number.',
      expect: { contains: variants(totalBudgeted) }
    },
    {
      id: 'cycle-end',
      prompt: 'What is the end date of my current pay cycle? Reply with the date as YYYY-MM-DD.',
      expect: { contains: [cycle.end] }
    },
    {
      id: 'forecast-payday',
      prompt: 'What is my projected balance on payday? Reply with just the number.',
      expect: { contains: variants(forecast.projectedEnd) }
    },
    {
      id: 'subscriptions',
      prompt: 'List the merchants of my detected subscriptions. Just the names.',
      expect:
        subs.length > 0
          ? { matches: new RegExp(subs[0].merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
          : { matches: /no subscriptions|none|don't see|do not see/i }
    },
    {
      id: 'goals-count',
      prompt: 'How many savings goals do I have? Reply with just the number.',
      expect: { contains: [String(goals.length)] }
    },
    {
      id: 'read-back',
      prompt: 'Read back my budget categories and tell me how many there are.',
      expect: { tool: 'read_back', contains: [String(cards)] }
    },
    {
      id: 'no-invention',
      prompt: 'What is my exact credit score and my KiwiSaver balance?',
      expect: { matches: /not sure|don't have|do not have|no data|not available|cannot|can't|unable|don't see/i }
    }
  ]

  if (topCategory) {
    cases.splice(1, 0, {
      id: 'category-budget',
      prompt: `How much is budgeted for ${topCategory.category} this cycle? Reply with just the number.`,
      expect: { contains: variants(topCategory.budgeted) }
    })
  }

  return cases
}

function buildMessages(prompt: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: baseSystemPrompt() },
    { role: 'system', content: memoryBlock() },
    { role: 'system', content: `<financial_context>\n${buildFinancialContext()}\n</financial_context>` },
    { role: 'user', content: prompt }
  ]
}

export async function runAiEvals(): Promise<EvalReport> {
  const cases = buildCases()
  const results: EvalCaseResult[] = []

  // A self-test must never be able to change real money data, even if the model
  // ignores the "read-only" wording in a prompt.
  setToolsReadOnly(true)
  try {
    await runCases()
  } finally {
    setToolsReadOnly(false)
  }

  const report: EvalReport = {
    ranAt: Date.now(),
    passed: results.filter((r) => r.ok).length,
    total: results.length,
    cases: results
  }

  getDb()
    .prepare('INSERT INTO ai_eval_runs (ran_at, passed, failed, detail) VALUES (?, ?, ?, ?)')
    .run(report.ranAt, report.passed, report.total - report.passed, JSON.stringify(report.cases))

  return report

  async function runCases(): Promise<void> {
    for (const c of cases) {
      const started = Date.now()
      const tools: string[] = []
      let content = ''
      let detail = ''
      let ok = false

      try {
        const reply = await streamChat({
          messages: buildMessages(c.prompt),
          onToken: () => {},
          onTool: (name) => tools.push(name),
          noReasoningFallback: true
        })
        content = reply.content
        const lower = content.toLowerCase()
        const problems: string[] = []

        if (!content.trim()) problems.push('empty answer')
        if (c.expect.tool && !tools.includes(c.expect.tool)) {
          problems.push(`expected tool ${c.expect.tool}, got [${tools.join(', ') || 'none'}]`)
        }
        if (c.expect.contains && !c.expect.contains.some((v) => lower.includes(v.toLowerCase()))) {
          problems.push(`missing any of ${c.expect.contains.slice(0, 3).join(' | ')}`)
        }
        if (c.expect.matches && !c.expect.matches.test(content)) {
          problems.push(`did not match ${c.expect.matches}`)
        }

        ok = problems.length === 0
        detail = ok
          ? content.replace(/\s+/g, ' ').slice(0, 160)
          : `${problems.join('; ')} — got: ${content.replace(/\s+/g, ' ').slice(0, 160)}`
      } catch (e) {
        detail = `error: ${(e as Error).message}`
      }

      results.push({
        id: c.id,
        prompt: c.prompt,
        ok,
        detail,
        tool: tools[0],
        ms: Date.now() - started
      })
    }
  }
}

export function lastEvalRun(): EvalReport | null {
  const row = getDb()
    .prepare('SELECT ran_at, passed, failed, detail FROM ai_eval_runs ORDER BY id DESC LIMIT 1')
    .get() as { ran_at: number; passed: number; failed: number; detail: string } | undefined
  if (!row) return null
  try {
    return {
      ranAt: row.ran_at,
      passed: row.passed,
      total: row.passed + row.failed,
      cases: JSON.parse(row.detail) as EvalCaseResult[]
    }
  } catch {
    return null
  }
}
