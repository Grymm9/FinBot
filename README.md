# FinanceBot

A local desktop financial management app for New Zealand, built with **Electron + React + TypeScript + Tailwind CSS**. It syncs your bank via **Akahu**, persists everything in **SQLite**, audits insurance policies and recurring subscriptions, fires **Discord** phone alerts around your income cycle, and ships a live **DeepSeek** AI chat that reads your financial data to give tailored advice.

> All data stays on your machine. API keys and bank tokens never leave the Electron main process.

---

## Features

- **Bank sync (Akahu)** — balances + categorized transaction streams, stored in SQLite.
- **Baseline budget import** — one-click CSV upload into the budget table.
- **Insurance & subscription auditor**
  - Drag-and-drop policy/renewal PDFs → auto-extracts provider, cover type, premium, renewal date.
  - Links policies to real bank debits.
  - Scans transactions for recurring charges and totals your monthly commitment.
- **Automated Discord alerts** — a background service checks spend pacing vs. your income cycle (before the 15th by default) and pings your phone if a category is on track to blow its budget.
- **Dashboard** — category progress bars, cash-flow chart, subscription overview, recent transactions.
- **Cash-flow forecast** — deterministic projection from today to payday (committed transfers, subscriptions, remaining budget, estimated income) with a low-balance warning.
- **Cycle reviews** — a written summary of each closed pay cycle (biggest overspends, new merchants, subscription load), posted to Discord once.
- **Persistent AI chat** — DeepSeek (`deepseek-chat`) gets a read-only JSON snapshot of your budget, transactions, subscriptions and insurance on every message.
- **AI write audit + undo** — every change the model makes is logged with the previous values; the chat shows an Undo button per action.
- **Service health** — background schedulers record success/failure; three consecutive failures notify Discord once per day.
- **Self-update** — verified installer downloads from a local folder feed, install only on request.

---

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron 33 (main + preload, sandboxed renderer) |
| UI | React 18, TypeScript, Tailwind CSS, Recharts |
| Build tooling | electron-vite, Vite |
| Database | SQLite via `better-sqlite3` |
| Bank API | Akahu (`https://api.akahu.io/v1`) |
| AI engine | DeepSeek (`deepseek-chat`, OpenAI-compatible streaming) |
| Phone alerts | Discord webhooks |

---

## Prerequisites

- **Node.js 18+** (Node 24 recommended)
- Windows / macOS / Linux with a working internet connection for bank + AI calls
- `better-sqlite3` is a native module. Prebuilt binaries are fetched for your Electron version automatically; if your platform/Electron combination has no prebuild, you'll need the **VS Build Tools** (Windows) or `build-essential` + `python3` (Linux/macOS).

---

## Install

```bash
# 1. Install dependencies (also rebuilds better-sqlite3 for Electron)
npm install

# 2. Create your environment file
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

If `npm install` fails at the native rebuild step (missing build tools), install dependencies first and rebuild separately:

```bash
npm install --ignore-scripts
npx electron-rebuild -f -w better-sqlite3
```

---

## Run

```bash
npm run dev        # launch the app in development (hot reload)
npm run build      # production build into out/
npm start          # preview the production build
npm run package:win  # create a Windows installer (optional)
npm run release:win  # installer + update.json manifest in release/
npm run publish:win -- <folder>   # copy installer + manifest to an update feed
npm run eval:ai    # AI regression suite against your live data (read-only)
```

Headless checks that run against your real database:

| Command | Purpose |
|---|---|
| `npx electron . --run-evals` | AI self-test (same as Settings → Run AI self-test) |
| `npx electron . --print-forecast` | Dump the cash-flow forecast, cycle reviews and service health as JSON |
| `npx electron . --self-test-audit` | Round-trip the AI write audit trail / undo on throwaway data |

### Updates

`npm run release:win` writes `release/update.json` (version, file, SHA-512, size).
Publish it with `npm run publish:win -- C:\path\to\feed`, then point
**Settings → App updates → Update feed folder** at that folder (the default feed
is `<userData>/update-feed`). The app checks on launch and every 6 hours,
verifies the SHA-512, and only installs when you click **Restart & install**.

> Bump `version` in `package.json` before `release:win` — the update check
> compares that number, so a rebuild with the same version is reported as
> "up to date".

---

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `AKAHU_APP_TOKEN` | Akahu app token |
| `AKAHU_USER_TOKEN` | Akahu personal access token for your account |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | Base URL (default `https://api.deepseek.com`) |
| `DEEPSEEK_MODEL` | Model id (default `deepseek-chat`) |
| `DISCORD_WEBHOOK_URL` | Discord webhook for phone alerts |
| `INCOME_CYCLE_DAY` | Day your income lands (default `15`) |
| `BUDGET_CHECK_DAY` | Check budget pacing up to this day (default `15`) |
| `ALERT_SPEND_RATIO` | Alert when projected spend exceeds this fraction of budget (default `0.8`) |

You can also configure everything from the **Settings** tab inside the app (values are stored in SQLite and override `.env`). Secrets set in the UI are masked and never sent to the renderer in plaintext.

### Getting your tokens

- **Akahu** — sign up at [my.akahu.nz](https://my.akahu.nz), create an app, then generate a **Personal App** (app token + user token) linked to your bank.
- **DeepSeek** — [platform.deepseek.com](https://platform.deepseek.com) → API keys.
- **Discord** — Server Settings → Integrations → Webhooks → New Webhook → copy the URL.

---

## Budget CSV format

A header row plus `(category, monthly budget)` rows. Column names are detected flexibly — any of `category`/`name`/`label` for the name, and `budget`/`amount`/`monthly` for the amount. Example:

```csv
Category,Monthly Budget
Groceries,800
Rent,2200
Utilities,350
Transport,200
Dining,250
Entertainment,120
```

Rows with unparseable amounts are skipped. If there is no recognisable header, columns are assumed to be `(category, budget)`.

---

## Project structure

```
FinanceBot/
├─ shared/types.ts               # Types shared between main and renderer
├─ src/
│  ├─ main/
│  │  ├─ index.ts                # Electron entry, window, scheduler
│  │  ├─ ipc.ts                  # IPC handlers (bridge to services)
│  │  ├─ db/index.ts             # SQLite connection + schema
│  │  └─ services/
│  │     ├─ akahu.ts             # Akahu client + sync
│  │     ├─ budget.ts            # CSV parser + category matching
│  │     ├─ subscriptions.ts     # recurring-charge scanner
│  │     ├─ insurance.ts         # PDF extractor + policy linker
│  │     ├─ discord.ts           # webhook helper
│  │     ├─ deepseek.ts          # streaming chat client
│  │     ├─ context.ts           # DB → AI financial snapshot
│  │     ├─ alerts.ts            # income-cycle budget checker + scheduler
│  │     ├─ dashboard.ts         # summary queries
│  │     └─ settings.ts          # settings store (DB → env → default)
│  ├─ preload/index.ts           # contextBridge API (window.api)
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ App.tsx
│        ├─ components/          # Dashboard, Budgets, Subscriptions, Insurance, Settings, ChatSidebar
│        └─ lib/format.ts
├─ electron.vite.config.ts
├─ .env.example
└─ package.json
```

---

## Security notes

- Renderer runs **sandboxed** with `contextIsolation` on and `nodeIntegration` off — it can only reach the backend through the typed `window.api` bridge.
- All secrets live in the main process (or SQLite) and are never exposed to the UI in plaintext.
- SQLite is stored in Electron's per-user `userData` directory (`financebot.sqlite3`).

## Troubleshooting

- **“Akahu tokens are not configured”** — set `AKAHU_APP_TOKEN` + `AKAHU_USER_TOKEN` in `.env` or Settings.
- **“DeepSeek API key is not configured”** — set `DEEPSEEK_API_KEY`.
- **`better-sqlite3` fails to load** — run `npx electron-rebuild -f -w better-sqlite3`.
- **PDF metadata blank** — some PDFs are image-only (no embedded text). Use the policy's **Edit** button to enter details manually.
