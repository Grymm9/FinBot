import { getDb } from '../db'
import {
  setCategoryBudget,
  addRule,
  listCategories,
  listRules,
  listCardMappings,
  setCardMapping,
  findTransactionsByKeyword
} from './budget'
import { getAllSettings } from './settings'
import { sendDiscordMessage } from './discord'
import { scheduleReminder, createUserReminder, deleteUserReminder, listUserReminders } from './reminders'
import { createMemory, updateMemory, deleteMemory, searchMemory, listMemories } from './memory'
import { SECRET_KEYS } from './secrets'
import { listGoals, contributeToGoal, createGoal, updateGoal } from './goals'
import { listSubscriptions, subscriptionMonthlyTotal } from './subscriptions'
import {
  logAction,
  snapshotCard,
  snapshotCategory,
  snapshotGoal,
  snapshotMemory,
  snapshotReminder,
  snapshotRuleByKeyword,
  latestRuleId
} from './ai-actions'

export interface ToolResult {
  summary: string
  data: Record<string, unknown>
  /** Set when the tool mutated data and the action can be undone. */
  actionId?: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<string, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

const TOOL_DEFS: AnyRecord[] = [
  {
    type: 'function',
    function: {
      name: 'update_budget_allocation',
      description: 'Update the budget amount for an existing category.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'The budget category name.' },
          amount: { type: 'number', description: 'New amount per period in NZD.' },
          frequency: {
            type: 'string',
            enum: ['monthly', 'fortnightly', 'weekly'],
            description: 'Payment frequency (default monthly).'
          }
        },
        required: ['category', 'amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_budget_line_item',
      description: 'Add a new budget line item (category) with an amount.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the new budget item.' },
          amount: { type: 'number', description: 'Amount per period in NZD.' },
          frequency: {
            type: 'string',
            enum: ['monthly', 'fortnightly', 'weekly'],
            description: 'Payment frequency (default monthly).'
          }
        },
        required: ['name', 'amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recategorize_transaction',
      description: 'Map a payee/transaction text to a budget category (persistent rule).',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Payee or transaction text, e.g. "STATE INS".' },
          category: { type: 'string', description: 'Budget category to map it to.' }
        },
        required: ['keyword', 'category']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_card_mapping',
      description: 'Pin a physical card number (e.g. "0759") to a budget envelope so its transactions resolve correctly.',
      parameters: {
        type: 'object',
        properties: {
          card: { type: 'string', description: 'Card number, e.g. "0759".' },
          category: { type: 'string', description: 'Budget category/envelope to map the card to.' }
        },
        required: ['card', 'category']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_back',
      description: 'Read back persisted data to verify a previous write actually persisted before reporting success.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['categories', 'rules', 'card_mappings', 'settings', 'unmatched'],
            description: 'What to read back.'
          }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_discord_reminder',
      description: 'Send a reminder message to Discord now, or schedule it for later.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The reminder message text.' },
          scheduled_at: {
            type: 'string',
            description: 'Optional ISO timestamp to schedule the reminder (otherwise sends now).'
          }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description: 'Create a recurring reminder that is posted to Discord 5 days, 2 days and on the target date.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The reminder text.' },
          target_date: { type: 'string', description: 'Target date in YYYY-MM-DD format.' },
          repeat: {
            type: 'string',
            enum: ['none', 'weekly', 'fortnightly', 'monthly'],
            description: 'How often the reminder repeats (default none).'
          }
        },
        required: ['message', 'target_date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_reminder',
      description: 'Delete one or more reminders by id, or by matching message text.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Reminder id to delete.' },
          message: { type: 'string', description: 'Delete reminders whose message contains this text.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Store a durable fact, preference or personal circumstance about the user so you remember it in future conversations. Never store money amounts, balances or budget figures.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'One short sentence, third person, e.g. "Prefers fortnightly budget summaries."' },
          kind: {
            type: 'string',
            enum: ['fact', 'preference', 'note'],
            description: 'Category of memory (default fact).'
          }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'Correct or re-classify an existing memory by id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Memory id.' },
          content: { type: 'string', description: 'Replacement text.' },
          kind: { type: 'string', enum: ['fact', 'preference', 'note', 'summary'] },
          pinned: { type: 'boolean', description: 'Pin so it is always included in your context.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Forget a memory by id, or all memories containing a phrase.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Memory id to delete.' },
          content: { type: 'string', description: 'Delete memories containing this text.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description:
        'Recall something from long-term memory or earlier conversations (both in-app and Discord). Use when the user refers to a past discussion you cannot see in the current context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to search memories and past messages for.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_goal',
      description:
        'Update a savings goal: add a contribution, or change its target amount / date. Identify it by id or by name.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Goal id (preferred).' },
          name: { type: 'string', description: 'Goal name, used if no id is given.' },
          contribute: { type: 'number', description: 'Amount to add to the saved total (negative to withdraw).' },
          saved_amount: { type: 'number', description: 'Set the saved total directly.' },
          target_amount: { type: 'number', description: 'Set a new target amount.' },
          target_date: { type: 'string', description: 'New target date (YYYY-MM-DD).' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_goal',
      description: 'Create a savings goal with a target amount and optional target date.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Goal name, e.g. "House deposit".' },
          target_amount: { type: 'number', description: 'Target amount in NZD.' },
          saved_amount: { type: 'number', description: 'Amount already saved (default 0).' },
          target_date: { type: 'string', description: 'Target date (YYYY-MM-DD).' }
        },
        required: ['name', 'target_amount']
      }
    }
  }
]

export function toolDefinitions(): AnyRecord[] {
  return TOOL_DEFS
}

const READ_ONLY_TOOLS = new Set(['read_back', 'search_memory', 'list_memories'])

let readOnly = false

/**
 * Disable every mutating tool. The AI self-test runs read-only prompts, but a
 * model that ignores them must not be able to change a real budget, so the
 * eval suite flips this on for the duration of the run.
 */
export function setToolsReadOnly(value: boolean): void {
  readOnly = value
}

export async function executeTool(name: string, args: AnyRecord): Promise<ToolResult> {
  if (readOnly && !READ_ONLY_TOOLS.has(name)) {
    return { summary: `Tool ${name} is disabled while the AI self-test runs.`, data: { blocked: true } }
  }
  switch (name) {
    case 'update_budget_allocation': {
      const category = String(args.category ?? '')
      const amount = Number(args.amount)
      const frequency = String(args.frequency || 'monthly')
      const before = getCategoryAmount(category)
      const snapshot = snapshotCategory(category)
      setCategoryBudget(category, amount, frequency)
      // Read back to verify persistence before reporting success.
      const after = getCategoryAmount(category)
      const summary = `Updated "${category}": $${before.toFixed(2)} → $${after.toFixed(2)} (${frequency})`
      const actionId = logAction({
        tool: name,
        summary,
        args,
        undo: { kind: 'category', key: category, row: snapshot }
      })
      return {
        summary,
        data: { category, previous: before, amount: after, frequency, verified: after === amount },
        actionId
      }
    }
    case 'add_budget_line_item': {
      const name = String(args.name ?? '')
      const amount = Number(args.amount)
      const frequency = String(args.frequency || 'monthly')
      const snapshot = snapshotCategory(name)
      setCategoryBudget(name, amount, frequency)
      const after = getCategoryAmount(name)
      const summary = `Added "${name}": $${after.toFixed(2)} (${frequency})`
      const actionId = logAction({
        tool: name,
        summary,
        args,
        undo: { kind: 'category', key: name, row: snapshot }
      })
      return {
        summary,
        data: { name, amount: after, frequency, verified: after === amount },
        actionId
      }
    }
    case 'recategorize_transaction': {
      const keyword = String(args.keyword ?? '')
      const category = String(args.category ?? '')
      const previousRule = snapshotRuleByKeyword(keyword)
      addRule(keyword, category)
      const affected = findTransactionsByKeyword(keyword)
      const summary = `Rule saved: "${keyword}" → ${category}. ${affected.length} existing transaction(s) now match.`
      const actionId = logAction({
        tool: name,
        summary,
        args,
        undo: { kind: 'rule', key: latestRuleId(normKeyword(keyword), category), row: previousRule }
      })
      return {
        summary,
        data: {
          keyword,
          category,
          affectedCount: affected.length,
          affectedTransactions: affected.slice(0, 50)
        },
        actionId
      }
    }
    case 'set_card_mapping': {
      const card = String(args.card ?? '').replace(/\D/g, '')
      const category = String(args.category ?? '')
      if (!card) return { summary: 'No card number provided.', data: {} }
      const snapshot = snapshotCard(card)
      setCardMapping(card, category)
      const summary = `Card "${card}" → ${category}.`
      const actionId = logAction({
        tool: name,
        summary,
        args,
        undo: { kind: 'card', key: card, row: snapshot }
      })
      return {
        summary,
        data: { card, category, mappings: listCardMappings() },
        actionId
      }
    }
    case 'read_back': {
      const target = String(args.target ?? 'categories')
      switch (target) {
        case 'categories':
          return { summary: `Read back ${listCategories().length} categories.`, data: { categories: listCategories() } }
        case 'rules':
          return { summary: `Read back ${listRules().length} rules.`, data: { rules: listRules() } }
        case 'card_mappings':
          return { summary: `Read back ${listCardMappings().length} card mappings.`, data: { mappings: listCardMappings() } }
        case 'settings':
          return {
            summary: 'Read back settings (secrets redacted).',
            data: {
              settings: Object.fromEntries(
                Object.entries(getAllSettings()).map(([k, v]) => [k, SECRET_KEYS.has(k) && v ? '••••••' : v])
              )
            }
          }
        case 'subscriptions':
          return {
            summary: `Read back ${listSubscriptions().length} subscriptions.`,
            data: { monthlyTotal: subscriptionMonthlyTotal(), subscriptions: listSubscriptions() }
          }
        case 'goals':
          return { summary: `Read back ${listGoals().length} goals.`, data: { goals: listGoals() } }
        case 'unmatched': {
          const rows = getDb()
            .prepare(
              `SELECT id, date, description, amount FROM transactions
               WHERE amount < 0 AND (category IS NULL OR category = '') ORDER BY date DESC LIMIT 50`
            )
            .all() as Array<Record<string, unknown>>
          return { summary: `Read back ${rows.length} uncategorised transactions.`, data: { unmatched: rows } }
        }
        default:
          return { summary: `Unknown read_back target: ${target}`, data: {} }
      }
    }
    case 'send_discord_reminder': {
      const message = String(args.message ?? '')
      const scheduledRaw = args.scheduled_at ? String(args.scheduled_at) : ''
      const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null
      if (scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now()) {
        scheduleReminder(message, scheduledAt)
        return {
          summary: `Scheduled reminder for ${scheduledAt.toISOString()}: "${message}"`,
          data: { scheduled: true, at: scheduledAt.toISOString(), message }
        }
      }
      await sendDiscordMessage(message)
      return { summary: 'Sent Discord reminder', data: { scheduled: false, message } }
    }
    case 'create_reminder': {
      const message = String(args.message ?? '').trim()
      const targetDate = String(args.target_date ?? '').trim()
      const repeat = String(args.repeat || 'none')
      if (!message || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return { summary: 'create_reminder needs a message and a target_date (YYYY-MM-DD).', data: {} }
      }
      const reminders = createUserReminder(message, targetDate, repeat)
      const created = [...reminders]
        .reverse()
        .find((r) => r.message === message && r.targetDate === targetDate)
      const summary = `Created reminder "${message}" for ${targetDate}${repeat !== 'none' ? ` (${repeat})` : ''}.`
      const actionId = created
        ? logAction({ tool: name, summary, args, undo: { kind: 'reminder', key: created.id, row: null } })
        : undefined
      return {
        summary,
        data: { message, targetDate, repeat, reminders },
        actionId
      }
    }
    case 'delete_reminder': {
      const id = args.id !== undefined && args.id !== null ? Number(args.id) : null
      const text = args.message ? String(args.message).toLowerCase() : ''
      const before = listUserReminders()
      const deletedRows: Array<{ id: number; message: string; targetDate: string; repeat: string }> = []
      if (id !== null) {
        const target = before.find((r) => r.id === id)
        if (target) {
          deletedRows.push(target)
          deleteUserReminder(id)
        }
      } else if (text) {
        for (const r of before) {
          if (r.message.toLowerCase().includes(text)) {
            deletedRows.push(r)
            deleteUserReminder(r.id)
          }
        }
      } else {
        return { summary: 'delete_reminder needs an id or a message.', data: {} }
      }
      const summary = `Deleted ${deletedRows.length} reminder${deletedRows.length === 1 ? '' : 's'}.`
      let actionId: number | undefined
      if (deletedRows.length === 1) {
        const row = snapshotReminder(deletedRows[0].id) ?? {
          id: deletedRows[0].id,
          message: deletedRows[0].message,
          target_date: deletedRows[0].targetDate,
          repeat: deletedRows[0].repeat
        }
        actionId = logAction({ tool: name, summary, args, undo: { kind: 'reminder', key: deletedRows[0].id, row } })
      }
      return {
        summary,
        data: { deleted: deletedRows.length, reminders: listUserReminders() },
        actionId
      }
    }
    case 'save_memory': {
      const content = String(args.content ?? '').trim()
      if (!content) return { summary: 'No memory content provided.', data: {} }
      const mem = createMemory(content, String(args.kind || 'fact'), 'ai')
      const summary = mem ? `Remembered: ${mem.content}` : 'Could not store that memory.'
      const actionId = mem
        ? logAction({ tool: name, summary, args, undo: { kind: 'memory', key: mem.id, row: null } })
        : undefined
      return {
        summary,
        data: { memory: mem, total: listMemories().length },
        actionId
      }
    }
    case 'update_memory': {
      const id = Number(args.id)
      if (!Number.isFinite(id)) return { summary: 'update_memory needs a numeric id.', data: {} }
      const snapshot = snapshotMemory(id)
      const mem = updateMemory(id, {
        content: args.content !== undefined ? String(args.content) : undefined,
        kind: args.kind !== undefined ? String(args.kind) : undefined,
        pinned: args.pinned !== undefined ? Boolean(args.pinned) : undefined
      })
      const summary = mem ? `Updated memory #${mem.id}: ${mem.content}` : `No memory with id ${id}.`
      const actionId = mem
        ? logAction({ tool: name, summary, args, undo: { kind: 'memory', key: id, row: snapshot } })
        : undefined
      return {
        summary,
        data: { memory: mem },
        actionId
      }
    }
    case 'delete_memory': {
      const id = args.id !== undefined && args.id !== null ? Number(args.id) : null
      const text = args.content ? String(args.content).toLowerCase() : ''
      const before = listMemories()
      const deletedIds: number[] = []
      if (id !== null && Number.isFinite(id)) {
        const snapshot = snapshotMemory(id)
        if (snapshot && deleteMemory(id)) deletedIds.push(id)
      } else if (text) {
        for (const m of before) {
          if (m.content.toLowerCase().includes(text)) {
            const snapshot = snapshotMemory(m.id)
            if (snapshot && deleteMemory(m.id)) deletedIds.push(m.id)
          }
        }
      } else {
        return { summary: 'delete_memory needs an id or content to match.', data: {} }
      }
      const summary = `Forgot ${deletedIds.length} memor${deletedIds.length === 1 ? 'y' : 'ies'}.`
      let actionId: number | undefined
      if (deletedIds.length === 1) {
        const row = snapshotMemory(deletedIds[0])
        if (row) actionId = logAction({ tool: name, summary, args, undo: { kind: 'memory', key: deletedIds[0], row } })
      }
      return {
        summary,
        data: { deleted: deletedIds.length, remaining: listMemories().length },
        actionId
      }
    }
    case 'search_memory': {
      const query = String(args.query ?? '').trim()
      if (!query) return { summary: 'No search query provided.', data: {} }
      const found = searchMemory(query)
      return {
        summary: `Found ${found.memories.length} memor${found.memories.length === 1 ? 'y' : 'ies'} and ${found.conversations.length} past message(s) for "${query}".`,
        data: { memories: found.memories, conversations: found.conversations }
      }
    }
    case 'update_goal': {
      const goals = listGoals()
      const id = args.id !== undefined && args.id !== null ? Number(args.id) : null
      const byName = args.name ? String(args.name).toLowerCase() : ''
      const goal = id !== null ? goals.find((g) => g.id === id) : goals.find((g) => g.name.toLowerCase().includes(byName))
      if (!goal) return { summary: 'No matching goal found.', data: { goals } }

      const snapshot = snapshotGoal(goal.id)

      if (args.contribute !== undefined && args.contribute !== null) {
        const updated = contributeToGoal(goal.id, Number(args.contribute))
        const summary = `Added $${Number(args.contribute).toFixed(2)} to "${goal.name}".`
        return {
          summary,
          data: { goal: updated },
          actionId: logAction({ tool: name, summary, args, undo: { kind: 'goal', key: goal.id, row: snapshot } })
        }
      }

      const updated = updateGoal(goal.id, {
        targetAmount: args.target_amount !== undefined ? Number(args.target_amount) : undefined,
        savedAmount: args.saved_amount !== undefined ? Number(args.saved_amount) : undefined,
        targetDate: args.target_date !== undefined ? String(args.target_date) : undefined
      })
      const summary = `Updated goal "${goal.name}".`
      return {
        summary,
        data: { goal: updated },
        actionId: logAction({ tool: name, summary, args, undo: { kind: 'goal', key: goal.id, row: snapshot } })
      }
    }
    case 'create_goal': {
      const name = String(args.name ?? '').trim()
      const target = Number(args.target_amount)
      if (!name || !Number.isFinite(target) || target <= 0) {
        return { summary: 'create_goal needs a name and a positive target_amount.', data: {} }
      }
      const goal = createGoal(
        name,
        target,
        args.saved_amount !== undefined ? Number(args.saved_amount) : 0,
        args.target_date ? String(args.target_date) : null
      )
      const summary = `Created goal "${name}" — target $${target.toFixed(2)}.`
      return {
        summary,
        data: { goal },
        actionId: goal
          ? logAction({ tool: name, summary, args, undo: { kind: 'goal', key: goal.id, row: null } })
          : undefined
      }
    }
    default:
      return { summary: `Unknown tool: ${name}`, data: {} }
  }
}

function getCategoryAmount(name: string): number {
  const row = getDb().prepare('SELECT amount FROM categories WHERE name = ?').get(name) as
    | { amount: number }
    | undefined
  return row?.amount ?? 0
}

/** Mirrors budget.ts `norm` so rule lookups match what addRule stored. */
function normKeyword(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
