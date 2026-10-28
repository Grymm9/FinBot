import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { REAL_TX, FUNDING_TX } from '../src/main/services/filters.ts'

/**
 * The money engine treats "real" transactions as: enabled account, and not
 * internal money movement. These tests exercise the SQL fragment itself against
 * an in-memory SQLite database, because a wrong exclusion silently changes
 * every budget and cycle total.
 */

type Row = {
  id: string
  accountId: string
  date: string
  description: string
  amount: number
  type?: string | null
}

const SEED: Row[] = [
  // regular spend / income — must be kept
  { id: 'a-keep-debit', accountId: 'everyday', date: '2026-10-20', description: 'COUNTDOWN', amount: -84.2, type: 'EFTPOS' },
  { id: 'b-keep-credit', accountId: 'everyday', date: '2026-10-20', description: 'SALARY', amount: 2400, type: 'DIRECT CREDIT' },
  // reimbursements are not "TFR FROM" and stay as real credits
  { id: 'c-keep-reimburse', accountId: 'everyday', date: '2026-10-21', description: 'From MS A J DOWLING BJJ', amount: 60, type: 'DIRECT CREDIT' },
  { id: 'u-keep-reimburse-prefixed', accountId: 'everyday', date: '2026-10-21', description: 'Yippee TFR FROM AJ DOWLING-', amount: 15, type: 'DIRECT CREDIT' },

  // disabled account — everything in it is ignored
  { id: 'd-disabled', accountId: 'old', date: '2026-10-20', description: 'COUNTDOWN', amount: -50, type: 'EFTPOS' },

  // explicitly internal
  { id: 'e-transfer', accountId: 'everyday', date: '2026-10-20', description: 'MB/PM TRANSFER', amount: -300, type: 'TRANSFER' },
  { id: 'f-atm', accountId: 'everyday', date: '2026-10-20', description: 'ATM WITHDRAWAL', amount: -100, type: 'ATM' },
  { id: 'g-tfr-from', accountId: 'envelope', date: '2026-10-20', description: 'TFR FROM DA ATTINGER 123', amount: 300, type: 'DIRECT CREDIT' },
  { id: 'h-tfr-from-other', accountId: 'envelope', date: '2026-10-20', description: 'TFR FROM J SMITH', amount: 45, type: 'DIRECT CREDIT' },
  { id: 'i-sharesies', accountId: 'everyday', date: '2026-10-20', description: 'SHARESIES NZ LTD', amount: -150, type: 'DIRECT DEBIT' },
  { id: 'j-sharesies-return', accountId: 'everyday', date: '2026-10-23', description: 'SHARESIES WITHDRAWAL', amount: 150, type: 'DIRECT CREDIT' },

  // envelope funding pair (same day, same amount) — both sides internal
  { id: 'k-tfr-to-paired', accountId: 'everyday', date: '2026-10-22', description: 'TFR TO RATES ENVELOPE', amount: -120, type: 'DIRECT DEBIT' },
  { id: 'l-tfr-from-paired', accountId: 'envelope', date: '2026-10-22', description: 'TFR FROM DA ATTINGER 456', amount: 120, type: 'DIRECT CREDIT' },

  // the bank sometimes prefixes funding with the envelope name
  { id: 'p-bundle-to-prefixed', accountId: 'everyday', date: '2026-10-15', description: 'Bundle TFR TO Bundle Insura', amount: -125.73, type: 'PAYMENT' },
  { id: 'q-bundle-from-prefixed', accountId: 'envelope', date: '2026-10-15', description: 'Bundle TFR FROM DA ATTINGER', amount: 125.73, type: 'DIRECT CREDIT' },
  { id: 'r-bundle-to-suffix', accountId: 'everyday', date: '2026-09-15', description: 'TFR TO Bundle Insura Bundle', amount: -125.73, type: 'STANDING ORDER' },
  { id: 's-bundle-from-suffix', accountId: 'envelope', date: '2026-09-15', description: 'TFR FROM DA ATTINGER Bundle', amount: 125.73, type: 'DIRECT CREDIT' },

  // unpaired TFR TO is a real external payment (gym, record label)
  { id: 'm-tfr-to-external', accountId: 'everyday', date: '2026-10-23', description: 'TFR TO IMPALER RECORDS', amount: -40, type: 'DIRECT DEBIT' },

  // same description/amount but on a different day is NOT a pair
  { id: 'n-tfr-to-other-day', accountId: 'everyday', date: '2026-10-24', description: 'TFR TO SAVINGS', amount: -70, type: 'DIRECT DEBIT' },
  { id: 'o-tfr-from-other-day', accountId: 'envelope', date: '2026-10-25', description: 'TFR FROM DA ATTINGER 789', amount: 70, type: 'DIRECT CREDIT' }
]

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      date TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      type TEXT
    );
  `)
  db.exec("INSERT INTO accounts (id, enabled) VALUES ('everyday', 1), ('envelope', 1), ('old', 0)")
  const ins = db.prepare(
    'INSERT INTO transactions (id, account_id, date, description, amount, type) VALUES (?, ?, ?, ?, ?, ?)'
  )
  for (const r of SEED) ins.run(r.id, r.accountId, r.date, r.description, r.amount, r.type ?? null)
  return db
}

function ids(db: DatabaseSync, where: string): string[] {
  return (db.prepare(`SELECT id FROM transactions WHERE ${where} ORDER BY id`).all() as Array<{ id: string }>).map(
    (r) => r.id
  )
}

test('REAL_TX keeps regular spend, income and reimbursements', () => {
  const db = makeDb()
  const kept = ids(db, REAL_TX)
  assert.ok(kept.includes('a-keep-debit'))
  assert.ok(kept.includes('b-keep-credit'))
  assert.ok(kept.includes('c-keep-reimburse'))
  // "Yippee TFR FROM AJ DOWLING" is money from another person, not envelope funding.
  assert.ok(kept.includes('u-keep-reimburse-prefixed'))
  db.close()
})

test('REAL_TX excludes disabled accounts', () => {
  const db = makeDb()
  assert.ok(!ids(db, REAL_TX).includes('d-disabled'))
  db.close()
})

test('REAL_TX excludes TRANSFER, ATM, TFR FROM and Sharesies', () => {
  const db = makeDb()
  const kept = ids(db, REAL_TX)
  for (const id of ['e-transfer', 'f-atm', 'g-tfr-from', 'h-tfr-from-other', 'i-sharesies', 'j-sharesies-return']) {
    assert.ok(!kept.includes(id), `${id} should be internal`)
  }
  db.close()
})

test('REAL_TX recognises funding prefixed with the envelope name', () => {
  const db = makeDb()
  const kept = ids(db, REAL_TX)
  // "Bundle TFR TO ..." paired with "Bundle TFR FROM DA ATTINGER"
  assert.ok(!kept.includes('p-bundle-to-prefixed'))
  assert.ok(!kept.includes('q-bundle-from-prefixed'))
  // "TFR TO ... Bundle" paired with "TFR FROM DA ATTINGER Bundle"
  assert.ok(!kept.includes('r-bundle-to-suffix'))
  assert.ok(!kept.includes('s-bundle-from-suffix'))
  db.close()
})

test('REAL_TX only excludes a TFR TO when a same-day same-amount pair exists', () => {
  const db = makeDb()
  const kept = ids(db, REAL_TX)
  assert.ok(!kept.includes('k-tfr-to-paired'), 'paired envelope funding is internal')
  assert.ok(!kept.includes('l-tfr-from-paired'), 'paired funding credit is internal')
  assert.ok(kept.includes('m-tfr-to-external'), 'unpaired TFR TO stays as spend')
  assert.ok(kept.includes('n-tfr-to-other-day'), 'a matching amount on another day is not a pair')
  db.close()
})

test('FUNDING_TX still sees envelope funding despite REAL_TX excluding it', () => {
  const db = makeDb()
  const funding = ids(db, FUNDING_TX)
  assert.deepEqual(funding, ['k-tfr-to-paired', 'm-tfr-to-external', 'n-tfr-to-other-day', 'r-bundle-to-suffix'])
  db.close()
})
