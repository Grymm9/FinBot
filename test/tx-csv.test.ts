import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsvRecords,
  parseStatementDate,
  parseTransactionCsv
} from '../src/main/services/tx-csv.ts'

test('parseStatementDate accepts ISO, day-first and month-name formats', () => {
  assert.equal(parseStatementDate('2026-10-13'), '2026-10-13')
  assert.equal(parseStatementDate('2026-10-13T09:30:00Z'), '2026-10-13')
  assert.equal(parseStatementDate('13/10/2026'), '2026-10-13')
  assert.equal(parseStatementDate('13-10-26'), '2026-10-13')
  assert.equal(parseStatementDate('13.10.2026'), '2026-10-13')
  assert.equal(parseStatementDate('13 Oct 2026'), '2026-10-13')
  assert.equal(parseStatementDate('13 October, 2026'), '2026-10-13')
  assert.equal(parseStatementDate('Oct 13, 2026'), '2026-10-13')
})

test('parseStatementDate reads month-first only when the day cannot be first', () => {
  // 10/13/2026 cannot be day-first, so it flips.
  assert.equal(parseStatementDate('10/13/2026'), '2026-10-13')
  // 02/03/2026 is ambiguous; NZ convention (day-first) wins → 2 March.
  assert.equal(parseStatementDate('02/03/2026'), '2026-03-02')
})

test('parseStatementDate rejects impossible or missing dates', () => {
  assert.equal(parseStatementDate(''), null)
  assert.equal(parseStatementDate(undefined), null)
  assert.equal(parseStatementDate('not a date'), null)
  assert.equal(parseStatementDate('31/02/2026'), null)
  assert.equal(parseStatementDate('2026-13-01'), null)
})

test('parseCsvRecords honours quotes, escaped quotes and embedded newlines', () => {
  const rows = parseCsvRecords('a,b\n"x,y","he said ""hi"""\n"multi\nline",z\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,y', 'he said "hi"'],
    ['multi\nline', 'z']
  ])
})

test('parseTransactionCsv detects headers and keeps signed amounts', () => {
  const csv = [
    'Date,Description,Amount,Account',
    '2026-10-01,Countdown,-54.20,Everyday',
    '2026-10-02,Salary,2100.00,Everyday'
  ].join('\n')

  const result = parseTransactionCsv(csv)
  assert.equal(result.rows.length, 2)
  assert.equal(result.skipped.length, 0)
  assert.deepEqual(result.columns, {
    date: 'Date',
    description: 'Description',
    amount: 'Amount',
    account: 'Account'
  })
  assert.deepEqual(result.rows[0], {
    date: '2026-10-01',
    description: 'Countdown',
    amount: -54.2,
    type: null,
    account: 'Everyday'
  })
  assert.equal(result.rows[1].amount, 2100)
})

test('parseTransactionCsv combines separate debit and credit columns', () => {
  const csv = [
    'Transaction Date,Particulars,Debit,Credit',
    '13/10/2026,Power bill,145.30,',
    '14/10/2026,Refund,,22.50'
  ].join('\n')

  const result = parseTransactionCsv(csv)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].amount, -145.3)
  assert.equal(result.rows[1].amount, 22.5)
  assert.equal(result.columns.amount, 'Debit / Credit')
})

test('parseTransactionCsv strips currency symbols and thousands separators', () => {
  const csv = 'Date,Details,Amount\n2026-10-05,"Rent, October","$2,200.00"'
  const result = parseTransactionCsv(csv)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].amount, 2200)
  assert.equal(result.rows[0].description, 'Rent, October')
})

test('parseTransactionCsv treats a parenthesised amount as money out', () => {
  const csv = 'Date,Description,Amount\n2026-10-06,Insurance,(88.40)'
  const result = parseTransactionCsv(csv)
  assert.equal(result.rows[0].amount, -88.4)
})

test('parseTransactionCsv falls back to positional columns without a header', () => {
  const csv = ['2026-10-01,Coffee,-5.50', '2026-10-02,Bus fare,-2.00'].join('\n')
  const result = parseTransactionCsv(csv)
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.columns, {
    date: null,
    description: null,
    amount: null,
    account: null
  })
  assert.equal(result.rows[1].description, 'Bus fare')
})

test('parseTransactionCsv skips unparseable rows and reports them', () => {
  const csv = [
    'Date,Description,Amount',
    '2026-10-01,Coffee,-5.50',
    'garbage row,not a date,abc',
    '2026-10-03,,12.00'
  ].join('\n')

  const result = parseTransactionCsv(csv)
  assert.equal(result.rows.length, 1)
  assert.equal(result.skipped.length, 2)
})

test('parseTransactionCsv joins the most specific description columns', () => {
  const csv = [
    'Date,Payee,Memo,Amount',
    '2026-10-07,Pak n Save,Weekly shop,-120.00'
  ].join('\n')

  const result = parseTransactionCsv(csv)
  assert.equal(result.rows[0].description, 'Pak n Save Weekly shop')
})

test('parseTransactionCsv handles an empty file', () => {
  const result = parseTransactionCsv('')
  assert.equal(result.rows.length, 0)
  assert.equal(result.skipped.length, 0)
})
