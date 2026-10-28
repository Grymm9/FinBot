import { useEffect, useState } from 'react'
import type { EmailRecord } from '@shared/types'
import { Badge, Button, Card, EmptyState, SectionHeader } from './ui'

export default function Email({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [showAll, setShowAll] = useState(false)

  const load = async (): Promise<void> => {
    setEmails(await window.api.listEmails())
  }

  useEffect(() => {
    load()
  }, [])

  const scan = async (): Promise<void> => {
    setScanning(true)
    setMessage('')
    const r = await window.api.scanEmails()
    if (r.error) setMessage(`❌ ${r.error}`)
    else {
      const parts = [`Found ${r.matches.length} relevant ${r.matches.length === 1 ? 'email' : 'emails'}.`]
      if (r.policyCount && r.policyCount > 0) {
        parts.push(`Created ${r.policyCount} insurance ${r.policyCount === 1 ? 'policy' : 'policies'}.`)
      }
      setMessage(parts.join(' '))
    }
    await load()
    onChanged()
    setScanning(false)
  }

  const flag = async (id: number, relevant: boolean): Promise<void> => {
    setEmails(await window.api.setEmailRelevant(id, relevant))
    onChanged()
  }

  const visible = showAll ? emails : emails.filter((e) => e.relevant)

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Email notifications"
        subtitle="Important emails from your inbox — insurance, bank and account notices."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Hide ignored' : 'Show all'}
            </Button>
            <Button onClick={scan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Scan emails'}
            </Button>
          </div>
        }
      />

      {message && <p className="text-sm text-accent">{message}</p>}

      {visible.length === 0 ? (
        <EmptyState
          title="No emails scanned yet"
          hint="Configure your email in Settings, then click “Scan emails” to find insurance and bank notifications."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-surface-800">
            {visible.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm ${e.relevant ? 'text-slate-200' : 'text-slate-500'}`}>
                      {e.subject || '(no subject)'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {e.from} · {e.date.slice(0, 10)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {e.keywords.map((k) => (
                        <Badge key={k} tone="neutral">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => flag(e.id, !e.relevant)}
                    className={`shrink-0 rounded-md px-2 py-1 text-xs ${
                      e.relevant ? 'text-slate-500 hover:text-warn' : 'text-accent'
                    }`}
                    title={e.relevant ? 'Flag as not important' : 'Mark important again'}
                  >
                    {e.relevant ? 'Ignore' : 'Restore'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
