import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { getDb } from '../db'
import { getSetting, setSetting } from './settings'
import { recordFail, recordOk } from './health'
import { importPolicyFromText } from './insurance'
import { localIsoDate } from './dates'
import { sendDiscordMessage } from './discord'
import { quickChat } from './deepseek'
import type { EmailMatch, EmailRecord, EmailScanResult } from '@shared/types'

const INSURANCE_KEYWORDS = [
  'insurance',
  'premium',
  'renewal',
  'policy',
  'cover note',
  'aa insurance',
  'ami ',
  'state insurance',
  'tower insurance',
  'aia ',
  'southern cross',
  'fidelity life',
  'partners life'
]

const BANK_KEYWORDS = [
  'bank',
  'account',
  'transaction',
  'deposit',
  'withdrawal',
  'payment',
  'balance',
  'asb ',
  'anz ',
  'bnz',
  'westpac',
  'kiwibank',
  'loan',
  'mortgage',
  'interest',
  'overdraft',
  'fee'
]

/** Scan the "important-finances" label for insurance / bank related emails. */
export async function scanEmails(limit = 60): Promise<EmailScanResult> {
  const user = getSetting('EMAIL_ADDRESS')
  const pass = getSetting('EMAIL_PASSWORD')
  const host = getSetting('EMAIL_HOST') || 'imap.gmail.com'
  const port = Number(getSetting('EMAIL_PORT') || 993)
  const label = getSetting('EMAIL_LABEL') || 'Important Finances'

  if (!user || !pass) {
    return { matches: [], error: 'Email address / app password not configured.' }
  }

  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false })

  try {
    await client.connect()
    const lock = await client.getMailboxLock(label)
    const matches: EmailMatch[] = []
    try {
      const mailbox = client.mailbox
      const total = mailbox ? mailbox.exists : 0
      if (total > 0) {
        const start = Math.max(1, total - limit + 1)
        const range = `${start}:*`
        for await (const msg of client.fetch(range, { envelope: true, source: true })) {
          const env = msg.envelope
          const subject = env?.subject ?? ''
          const from = (env?.from ?? []).map((f) => f.address ?? f.name ?? '').join(', ')
          const date = env?.date ? localIsoDate(env.date) : ''
          const raw = msg.source?.toString() ?? ''

          // Parse the full email body (decodes base64 / quoted-printable, extracts text).
          let body = ''
          try {
            const parsed = await simpleParser(raw)
            body = (parsed.text || stripHtml(parsed.html || '')).replace(/\s+/g, ' ').trim()
          } catch {
            body = ''
          }

          const text = `${subject} ${from} ${body}`.toLowerCase()
          const keywords = [...INSURANCE_KEYWORDS, ...BANK_KEYWORDS].filter((k) => text.includes(k))
          if (keywords.length > 0) {
            matches.push({
              subject,
              from,
              date,
              snippet: body.slice(0, 400),
              keywords: [...new Set(keywords)]
            })
          }
        }
      }
    } finally {
      lock.release()
    }
    await client.logout()

    const newMatches = persistMatches(matches)
    let policyCount = 0
    for (const m of newMatches) {
      if (m.keywords.some((k) => INSURANCE_KEYWORDS.includes(k))) {
        const policy = importPolicyFromText(`${m.subject}\n${m.snippet}`, m.subject)
        if (policy) policyCount++
      }
    }

    // Post new important emails to Discord (fire-and-forget), but skip the
    // very first scan so existing label contents don't flood the channel.
    const alreadyScanned = getSetting('email_scanned') === '1'
    if (newMatches.length > 0 && alreadyScanned) {
      void notifyDiscord(newMatches)
    }
    setSetting('email_scanned', '1')

    return { matches, policyCount }
  } catch (e) {
    try {
      await client.logout()
    } catch {
      // ignore
    }
    return { matches: [], error: (e as Error).message }
  }
}

/** Post an AI-summarised Discord message for newly-arrived important emails. */
async function notifyDiscord(matches: EmailMatch[]): Promise<void> {
  try {
    const lines: string[] = []
    for (const m of matches) {
      const summary = await quickChat([
        {
          role: 'system',
          content:
            'Summarise a personal-finance email for a one-line notification. Reply with a single concise sentence (under 25 words) covering what it is about and any amount, action, or due date. No preamble, no sign-off.'
        },
        { role: 'user', content: `Subject: ${m.subject || '(no subject)'}\nFrom: ${m.from}\n\n${m.snippet}` }
      ])
      const s = summary.trim()
      lines.push(`📧 **${m.subject || '(no subject)'}** — ${s || `${m.from} · ${m.date}`}`)
    }
    await sendDiscordMessage(`📬 **New important email${matches.length > 1 ? 's' : ''}:**\n${lines.join('\n')}`)
  } catch (e) {
    console.error('Discord email notify failed:', e)
  }
}

/** Poll the "important-finances" label periodically and notify Discord of new emails. */
export function startEmailScheduler(): NodeJS.Timeout {
  const run = (): void => {
    // Don't report "not configured" as a failure — the user may not use email.
    if (!getSetting('EMAIL_ADDRESS') || !getSetting('EMAIL_PASSWORD')) return
    scanEmails()
      .then((r) => (r.error ? recordFail('email', r.error) : recordOk('email')))
      .catch((e) => recordFail('email', e))
  }
  setTimeout(run, 10_000)
  return setInterval(run, 5 * 60_000)
}

function persistMatches(matches: EmailMatch[]): EmailMatch[] {
  const db = getDb()
  const exists = db.prepare('SELECT 1 FROM emails WHERE subject = ? AND from_addr = ? AND date = ? LIMIT 1')
  const insert = db.prepare(
    'INSERT INTO emails (subject, from_addr, date, snippet, keywords, relevant, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  )
  const newMatches: EmailMatch[] = []
  for (const m of matches) {
    if (exists.get(m.subject, m.from, m.date)) continue
    insert.run(m.subject, m.from, m.date, m.snippet, JSON.stringify(m.keywords), Date.now())
    newMatches.push(m)
  }
  return newMatches
}

/** All stored emails (most recent first). */
export function listEmails(): EmailRecord[] {
  const rows = getDb()
    .prepare('SELECT id, subject, from_addr, date, snippet, keywords, relevant FROM emails ORDER BY date DESC, id DESC')
    .all() as Array<{
    id: number
    subject: string
    from_addr: string
    date: string
    snippet: string
    keywords: string
    relevant: number
  }>
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject ?? '',
    from: r.from_addr ?? '',
    date: r.date ?? '',
    snippet: r.snippet ?? '',
    keywords: safeParse(r.keywords),
    relevant: r.relevant === 1
  }))
}

export function setEmailRelevant(id: number, relevant: boolean): EmailRecord[] {
  getDb().prepare('UPDATE emails SET relevant = ? WHERE id = ?').run(relevant ? 1 : 0, id)
  return listEmails()
}

function safeParse(s: string): string[] {
  try {
    return JSON.parse(s)
  } catch {
    return []
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
