import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(join(process.env.APPDATA ?? '', 'financebot', 'financebot.sqlite3'))
const start = '2026-10-13'
const end = '2026-11-13'
const enabled = 'account_id IN (SELECT id FROM accounts WHERE enabled = 1)'

const out = db.prepare(
  `SELECT t.date, t.amount, t.type, a.name acc, t.description, t.merchant
   FROM transactions t JOIN accounts a ON a.id = t.account_id
   WHERE ${enabled} AND t.amount < 0 AND t.date >= ? AND t.date < ?
   ORDER BY t.amount ASC LIMIT 40`
).all(start, end) as Array<{ date: string; amount: number; type: string | null; acc: string; description: string; merchant: string | null }>
for (const r of out) {
  console.log(`${r.date}  ${String(r.type).padEnd(12)} $${Math.abs(r.amount).toFixed(2).padStart(9)}  [${r.acc}]  ${r.description.slice(0, 55)}${r.merchant ? '  (' + r.merchant + ')' : ''}`)
}
db.close()
