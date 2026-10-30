import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT,
  connection_id TEXT,
  status        TEXT,
  currency      TEXT DEFAULT 'NZD',
  raw           TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,
  account_id  TEXT,
  date        TEXT,
  description TEXT,
  amount      REAL,
  type        TEXT,
  category    TEXT,
  merchant    TEXT,
  raw         TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_tx_date    ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_desc    ON transactions(description);

CREATE TABLE IF NOT EXISTS balances (
  account_id TEXT PRIMARY KEY,
  current    REAL,
  available  REAL,
  currency   TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  frequency   TEXT NOT NULL DEFAULT 'monthly',
  color       TEXT,
  split       INTEGER NOT NULL DEFAULT 0,
  active_from TEXT,
  updated_at  INTEGER
);

CREATE TABLE IF NOT EXISTS budget_history (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  month    TEXT NOT NULL,
  category TEXT NOT NULL,
  budgeted REAL DEFAULT 0,
  spent    REAL DEFAULT 0,
  UNIQUE(month, category)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT,
  merchant     TEXT NOT NULL,
  amount       REAL NOT NULL,
  previous_amount REAL,
  cadence      TEXT,
  monthly_amount REAL DEFAULT 0,
  last_date    TEXT,
  occurrences  INTEGER DEFAULT 0,
  confidence   REAL DEFAULT 0,
  price_rose   INTEGER NOT NULL DEFAULT 0,
  account_id   TEXT
);

CREATE TABLE IF NOT EXISTS insurance_policies (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  provider              TEXT,
  cover_type            TEXT,
  premium               REAL,
  frequency             TEXT,
  renewal_date          TEXT,
  source_file           TEXT,
  extracted_json        TEXT,
  linked_transaction_id TEXT,
  created_at            INTEGER
);

CREATE TABLE IF NOT EXISTS insurance_bundles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT,
  linked_transaction_id TEXT,
  source_file           TEXT,
  created_at            INTEGER
);

CREATE TABLE IF NOT EXISTS insurance_bundle_items (
  bundle_id INTEGER NOT NULL,
  policy_id INTEGER NOT NULL,
  PRIMARY KEY (bundle_id, policy_id)
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER,
  channel    TEXT NOT NULL DEFAULT 'app'
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created ON chat_logs(created_at);

CREATE TABLE IF NOT EXISTS discord_chat (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'fact',
  content    TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'app',
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS alert_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  type    TEXT,
  message TEXT,
  sent_at INTEGER,
  success INTEGER
);

CREATE TABLE IF NOT EXISTS category_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword    TEXT NOT NULL,
  category   TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS card_mappings (
  card     TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS manual_assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  message      TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  sent         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER
);

CREATE TABLE IF NOT EXISTS user_reminders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message     TEXT NOT NULL,
  target_date TEXT NOT NULL,
  repeat      TEXT NOT NULL DEFAULT 'none',
  created_at  INTEGER
);

CREATE TABLE IF NOT EXISTS reminder_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id INTEGER NOT NULL,
  target_date TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  sent_at     INTEGER,
  UNIQUE(reminder_id, target_date, offset_days)
);

CREATE TABLE IF NOT EXISTS emails (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject    TEXT,
  from_addr  TEXT,
  date       TEXT,
  snippet    TEXT,
  keywords   TEXT,
  relevant   INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS budget_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_number TEXT,
  expected_total REAL,
  account_type   TEXT,
  transfer_label TEXT,
  created_at     INTEGER
);

CREATE TABLE IF NOT EXISTS budget_group_items (
  group_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY (group_id, category)
);

CREATE TABLE IF NOT EXISTS budget_group_destinations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id       INTEGER NOT NULL,
  amount         REAL,
  account_number TEXT,
  account_type   TEXT,
  transfer_label TEXT
);

CREATE TABLE IF NOT EXISTS category_destinations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  category       TEXT NOT NULL,
  amount         REAL,
  account_number TEXT,
  account_type   TEXT,
  transfer_label TEXT
);

CREATE TABLE IF NOT EXISTS payment_matches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_id INTEGER NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'group',
  transaction_id TEXT NOT NULL,
  cycle_start    TEXT NOT NULL,
  created_at     INTEGER
);

CREATE TABLE IF NOT EXISTS dismissed_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key   TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  created_at  INTEGER,
  UNIQUE(alert_key, cycle_start)
);

CREATE TABLE IF NOT EXISTS cycle_history (
  cycle_start TEXT PRIMARY KEY,
  cycle_end   TEXT NOT NULL,
  label       TEXT,
  income      REAL NOT NULL DEFAULT 0,
  expense     REAL NOT NULL DEFAULT 0,
  net         REAL NOT NULL DEFAULT 0,
  closed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  target_amount REAL NOT NULL DEFAULT 0,
  saved_amount  REAL NOT NULL DEFAULT 0,
  target_date   TEXT,
  created_at    INTEGER,
  updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS subscription_ignores (
  merchant_key TEXT PRIMARY KEY,
  created_at   INTEGER
);

CREATE TABLE IF NOT EXISTS notified_alerts (
  alert_key TEXT PRIMARY KEY,
  sent_at   INTEGER
);

CREATE TABLE IF NOT EXISTS service_health (
  service              TEXT PRIMARY KEY,
  last_ok              INTEGER,
  last_error           TEXT,
  last_error_at        INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discord_threads (
  thread_id         TEXT PRIMARY KEY,
  parent_channel_id TEXT NOT NULL,
  title             TEXT,
  last_message_id   TEXT,
  created_at        INTEGER,
  updated_at        INTEGER
);

CREATE TABLE IF NOT EXISTS reviews (
  cycle_start TEXT PRIMARY KEY,
  label       TEXT,
  headline    TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  metrics     TEXT,
  created_at  INTEGER
);

CREATE TABLE IF NOT EXISTS ai_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tool       TEXT NOT NULL,
  summary    TEXT,
  args       TEXT,
  undo       TEXT,
  undone     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_actions_created ON ai_actions(created_at);

CREATE TABLE IF NOT EXISTS ai_eval_runs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at   INTEGER,
  passed   INTEGER,
  failed   INTEGER,
  detail   TEXT
);

CREATE TABLE IF NOT EXISTS deal_plans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT NOT NULL,
  provider      TEXT NOT NULL,
  plan_name     TEXT NOT NULL,
  monthly_price REAL,
  variable_rate REAL,
  daily_charge  REAL,
  region        TEXT,
  source_url    TEXT,
  verified_at   INTEGER,
  stale         INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE(category, provider, plan_name)
);

CREATE TABLE IF NOT EXISTS ai_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key      TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'warn',
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  merchant        TEXT,
  category        TEXT,
  amount          REAL,
  previous_amount REAL,
  cycle_start     TEXT,
  created_at      INTEGER,
  updated_at      INTEGER,
  read_at         INTEGER,
  dismissed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_active ON ai_alerts(dismissed_at, read_at);
`

let _db: Database.Database | null = null

/**
 * Lazily open (and migrate) the SQLite database stored in Electron's
 * per-user `userData` directory. Must be called after app is ready.
 */
export function getDb(): Database.Database {
  if (_db) return _db

  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'financebot.sqlite3')

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)

  _db = db
  return db
}

/** Additive migrations for databases created before a given schema change. */
function migrate(db: Database.Database): void {
  const acctCols = db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
  if (!acctCols.some((c) => c.name === 'enabled')) {
    db.exec('ALTER TABLE accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
    // One-time heuristic: exclude loan/savings accounts from calculations by
    // default, since they inflate income/spending with transfers and
    // repayments. The user can re-enable them from the Accounts view.
    db.exec(
      "UPDATE accounts SET enabled = 0 WHERE type = 'LOAN' OR name LIKE '%loan%' OR name LIKE '%lending%' OR name LIKE '%unused%' OR name LIKE '%waiting%'"
    )
  }

  const catCols = db.prepare('PRAGMA table_info(categories)').all() as Array<{ name: string }>
  if (catCols.some((c) => c.name === 'monthly_budget')) {
    db.exec('ALTER TABLE categories RENAME COLUMN monthly_budget TO amount')
  }
  if (!catCols.some((c) => c.name === 'frequency')) {
    db.exec("ALTER TABLE categories ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly'")
  }
  if (!catCols.some((c) => c.name === 'split')) {
    db.exec('ALTER TABLE categories ADD COLUMN split INTEGER NOT NULL DEFAULT 0')
  }
  if (!catCols.some((c) => c.name === 'active_from')) {
    db.exec('ALTER TABLE categories ADD COLUMN active_from TEXT')
  }
  if (!catCols.some((c) => c.name === 'updated_at')) {
    db.exec('ALTER TABLE categories ADD COLUMN updated_at INTEGER')
  }

  const groupCols = db.prepare('PRAGMA table_info(budget_groups)').all() as Array<{ name: string }>
  if (!groupCols.some((c) => c.name === 'account_type')) {
    db.exec('ALTER TABLE budget_groups ADD COLUMN account_type TEXT')
  }
  if (!groupCols.some((c) => c.name === 'transfer_label')) {
    db.exec('ALTER TABLE budget_groups ADD COLUMN transfer_label TEXT')
  }

  const polCols = db.prepare('PRAGMA table_info(insurance_policies)').all() as Array<{ name: string }>
  if (!polCols.some((c) => c.name === 'frequency')) {
    db.exec('ALTER TABLE insurance_policies ADD COLUMN frequency TEXT')
  }

  const bundleCols = db.prepare('PRAGMA table_info(insurance_bundles)').all() as Array<{ name: string }>
  if (!bundleCols.some((c) => c.name === 'linked_transaction_id')) {
    db.exec('ALTER TABLE insurance_bundles ADD COLUMN linked_transaction_id TEXT')
  }
  if (!bundleCols.some((c) => c.name === 'source_file')) {
    db.exec('ALTER TABLE insurance_bundles ADD COLUMN source_file TEXT')
  }

  const pmCols = db.prepare('PRAGMA table_info(payment_matches)').all() as Array<{ name: string }>
  if (!pmCols.some((c) => c.name === 'kind')) {
    db.exec("ALTER TABLE payment_matches ADD COLUMN kind TEXT NOT NULL DEFAULT 'group'")
  }

  // Migrate single-destination group data into the destinations table (one-time).
  const destCount = db.prepare('SELECT COUNT(*) AS c FROM budget_group_destinations').get() as { c: number }
  if (destCount.c === 0 && groupCols.some((c) => c.name === 'account_number')) {
    const groups = db
      .prepare('SELECT id, account_number, expected_total, account_type, transfer_label FROM budget_groups WHERE account_number IS NOT NULL')
      .all() as Array<{
      id: number
      account_number: string
      expected_total: number | null
      account_type: string | null
      transfer_label: string | null
    }>
    const ins = db.prepare(
      'INSERT INTO budget_group_destinations (group_id, amount, account_number, account_type, transfer_label) VALUES (?, ?, ?, ?, ?)'
    )
    for (const g of groups) ins.run(g.id, g.expected_total, g.account_number, g.account_type, g.transfer_label)
  }

  // Unified conversation timeline: chat_logs gains a channel column and the
  // legacy discord_chat table is folded in (one-time, idempotent).
  const chatCols = db.prepare('PRAGMA table_info(chat_logs)').all() as Array<{ name: string }>
  if (!chatCols.some((c) => c.name === 'channel')) {
    db.exec("ALTER TABLE chat_logs ADD COLUMN channel TEXT NOT NULL DEFAULT 'app'")
  }
  const hasDiscordRows = db.prepare("SELECT 1 FROM chat_logs WHERE channel = 'discord' LIMIT 1").get()
  if (!hasDiscordRows) {
    db.exec(
      `INSERT INTO chat_logs (role, content, created_at, channel)
       SELECT role, content, created_at, 'discord' FROM discord_chat ORDER BY id ASC`
    )
  }

  // Stable merchant identity for detected subscriptions.
  const subCols = db.prepare('PRAGMA table_info(subscriptions)').all() as Array<{ name: string }>
  if (!subCols.some((c) => c.name === 'key')) {
    db.exec('ALTER TABLE subscriptions ADD COLUMN key TEXT')
  }
  if (!subCols.some((c) => c.name === 'price_rose')) {
    db.exec('ALTER TABLE subscriptions ADD COLUMN price_rose INTEGER NOT NULL DEFAULT 0')
  }
  if (!subCols.some((c) => c.name === 'previous_amount')) {
    db.exec('ALTER TABLE subscriptions ADD COLUMN previous_amount REAL')
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
