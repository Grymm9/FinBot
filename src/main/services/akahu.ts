import { getDb } from '../db'
import { getSetting } from './settings'
import { localIsoDate, toLocalDate, detectTimeZone } from './dates'
import type { SyncResult } from '@shared/types'

const AKAHU_BASE = 'https://api.akahu.io/v1'

function headers(): Record<string, string> {
  const app = getSetting('AKAHU_APP_TOKEN')
  const user = getSetting('AKAHU_USER_TOKEN')
  if (!app || !user) {
    throw new Error('Akahu tokens are not configured. Set AKAHU_APP_TOKEN and AKAHU_USER_TOKEN.')
  }
  return {
    // Akahu auth: the User Access Token goes in `Authorization: Bearer`,
    // and the App ID Token goes in the `X-Akahu-Id` header.
    Authorization: `Bearer ${user}`,
    'X-Akahu-Id': app,
    'Content-Type': 'application/json'
  }
}

async function akahuGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(AKAHU_BASE + path)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), { method: 'GET', headers: headers() })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Akahu ${path} failed (${res.status}): ${body}`)
  }
  return (await res.json()) as T
}

interface AkahuAccount {
  _id: string
  name: string
  type?: string
  connection?: { _id?: string }
  status?: string
  attributes?: unknown
  balance?: { currency?: string; current?: number; available?: number }
}

interface AkahuTransaction {
  _id: string
  _account: string
  date: string
  description: string
  amount: number
  type?: string
  category?: { name?: string }
  merchant?: { name?: string }
}

interface Paged<T> {
  success: boolean
  items: T[]
  cursor?: { next?: string }
}

export async function getAccounts(): Promise<AkahuAccount[]> {
  const res = await akahuGet<Paged<AkahuAccount>>('/accounts')
  return res.items
}

/** Fetch all transactions since `start` (ISO date), following pagination. */
export async function getAllTransactions(start: string, end: string): Promise<AkahuTransaction[]> {
  const out: AkahuTransaction[] = []
  let cursor: string | undefined
  // Safety valve against infinite pagination.
  let pages = 0
  do {
    const res = await akahuGet<Paged<AkahuTransaction>>('/transactions', {
      start: `${start}T00:00:00.000Z`,
      end: `${end}T23:59:59.999Z`,
      cursor: cursor ?? ''
    })
    out.push(...res.items)
    cursor = res.cursor?.next
    pages += 1
  } while (cursor && pages < 200)
  return out
}

/** Pull accounts, balances and a rolling transaction window into SQLite. */
export async function syncAll(days = 365): Promise<SyncResult> {
  const db = getDb()
  const now = new Date()
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const upsertAccount = db.prepare(
    `INSERT INTO accounts (id, name, type, connection_id, status, currency, raw, updated_at)
     VALUES (@id, @name, @type, @connection_id, @status, @currency, @raw, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, type=excluded.type, status=excluded.status, currency=excluded.currency,
       raw=excluded.raw, updated_at=excluded.updated_at`
  )
  const upsertBalance = db.prepare(
    `INSERT INTO balances (account_id, current, available, currency, updated_at)
     VALUES (@account_id, @current, @available, @currency, @updated_at)
     ON CONFLICT(account_id) DO UPDATE SET
       current=excluded.current, available=excluded.available, updated_at=excluded.updated_at`
  )
  const upsertTx = db.prepare(
    `INSERT INTO transactions (id, account_id, date, description, amount, type, category, merchant, raw)
     VALUES (@id, @account_id, @date, @description, @amount, @type, @category, @merchant, @raw)
     ON CONFLICT(id) DO UPDATE SET
       date=excluded.date, description=excluded.description, amount=excluded.amount, category=excluded.category`
  )

  const accounts = await getAccounts()
  // Balances are embedded in each account object (Akahu has no /balances endpoint).
  const balances = accounts.map((a) => ({
    _account: a._id,
    current: a.balance?.current ?? 0,
    available: a.balance?.available ?? a.balance?.current ?? 0
  }))
  const transactions = await getAllTransactions(localIsoDate(start), localIsoDate(now))

  const save = db.transaction(() => {
    const ts = Date.now()
    for (const a of accounts) {
      upsertAccount.run({
        id: a._id,
        name: a.name,
        type: a.type ?? null,
        connection_id: a.connection?._id ?? null,
        status: a.status ?? null,
        currency: 'NZD',
        raw: JSON.stringify(a),
        updated_at: ts
      })
    }
    for (const b of balances) {
      upsertBalance.run({
        account_id: b._account,
        current: b.current,
        available: b.available ?? b.current,
        currency: 'NZD',
        updated_at: ts
      })
    }
    const tz = detectTimeZone()
    for (const t of transactions) {
      upsertTx.run({
        id: t._id,
        account_id: t._account,
        date: toLocalDate(t.date, tz),
        description: t.description,
        amount: t.amount,
        type: t.type ?? null,
        category: t.category?.name ?? null,
        merchant: t.merchant?.name ?? null,
        raw: JSON.stringify(t)
      })
    }
  })
  save()

  setSettingSync('last_sync', new Date().toISOString())

  return {
    accounts: accounts.length,
    balances: balances.length,
    transactions: transactions.length
  }
}

function setSettingSync(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}
