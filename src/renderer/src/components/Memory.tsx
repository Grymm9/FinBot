import { useEffect, useMemo, useState } from 'react'
import type { ConversationEntry, Memory, MemorySearchResult } from '@shared/types'
import { Badge, Button, Card, EmptyState, SectionHeader, Spinner } from './ui'

const KIND_OPTIONS = [
  { value: 'fact', label: 'Fact' },
  { value: 'preference', label: 'Preference' },
  { value: 'note', label: 'Note' }
]

const kindTone = (kind: string): 'neutral' | 'good' | 'warn' => {
  if (kind === 'preference') return 'good'
  if (kind === 'note') return 'warn'
  return 'neutral'
}

function when(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Pacific/Auckland'
  })
}

const fieldCls =
  'rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none'
const inputCls = `mt-1 block w-full ${fieldCls}`

export default function MemoryPage({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [memories, setMemories] = useState<Memory[]>([])
  const [conversations, setConversations] = useState<ConversationEntry[]>([])
  const [content, setContent] = useState('')
  const [kind, setKind] = useState('fact')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemorySearchResult | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async (): Promise<void> => {
    const [m, c] = await Promise.all([window.api.listMemories(), window.api.listConversations(60)])
    setMemories(m)
    setConversations(c)
  }

  useEffect(() => {
    load()
  }, [])

  // Debounced search across memories + full conversation history.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    const t = setTimeout(() => {
      window.api.searchMemory(q).then(setResults).catch(() => setResults(null))
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const add = async (): Promise<void> => {
    if (!content.trim()) return
    await window.api.createMemory(content.trim(), kind)
    setContent('')
    setKind('fact')
    await load()
    onChanged()
  }

  const saveEdit = async (id: number): Promise<void> => {
    if (!editText.trim()) return
    await window.api.updateMemory(id, { content: editText.trim() })
    setEditingId(null)
    setEditText('')
    await load()
    onChanged()
  }

  const togglePin = async (m: Memory): Promise<void> => {
    await window.api.updateMemory(m.id, { pinned: !m.pinned })
    await load()
  }

  const remove = async (id: number): Promise<void> => {
    await window.api.deleteMemory(id)
    await load()
    onChanged()
  }

  const scan = async (): Promise<void> => {
    setBusy(true)
    setNotice('')
    try {
      const r = await window.api.distillMemories(true)
      await load()
      setNotice(r.added === 0 ? 'No new memories found in recent conversations.' : `Added ${r.added} new memory item(s).`)
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pinned = useMemo(() => memories.filter((m) => m.pinned), [memories])
  const rest = useMemo(() => memories.filter((m) => !m.pinned), [memories])

  const renderRow = (m: Memory): JSX.Element => (
    <li key={m.id} className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        {editingId === m.id ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={2}
              className={`${inputCls} resize-none`}
            />
            <div className="flex gap-2">
              <Button onClick={() => saveEdit(m.id)} disabled={!editText.trim()} className="px-3 py-1 text-xs">
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditingId(null)} className="px-3 py-1 text-xs">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-200">{m.content}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={kindTone(m.kind)}>{m.kind}</Badge>
              {m.pinned && <Badge tone="good">pinned</Badge>}
              <span className="text-[11px] text-slate-500">
                {m.source} · {when(m.updatedAt)}
              </span>
            </div>
          </>
        )}
      </div>
      {editingId !== m.id && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => togglePin(m)}
            title={m.pinned ? 'Unpin' : 'Pin to context'}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              m.pinned ? 'text-accent hover:bg-accent/10' : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300'
            }`}
          >
            {m.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button
            onClick={() => {
              setEditingId(m.id)
              setEditText(m.content)
            }}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
          >
            Edit
          </button>
          <button
            onClick={() => remove(m.id)}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-danger/15 hover:text-danger"
          >
            Forget
          </button>
        </div>
      )}
    </li>
  )

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Memory"
        subtitle="Everything FinanceBot has retained from your app and Discord conversations."
        action={
          <Button variant="secondary" onClick={scan} disabled={busy}>
            {busy ? <Spinner /> : null}
            Scan conversations
          </Button>
        }
      />

      {notice && <p className="text-xs text-accent">{notice}</p>}

      <Card className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Add a memory</h3>
          <p className="text-xs text-slate-500">
            Stored permanently and shared by the in-app chat and Discord. Money figures are always read live, so keep
            memories about preferences and circumstances.
          </p>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          placeholder="e.g. Prefers being told the single most important action, not a list."
          className={`${inputCls} resize-none`}
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${fieldCls} mt-1 w-40`}>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={add} disabled={!content.trim()}>
            Save memory
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">
            Retained memories
            <span className="ml-2 text-xs font-normal text-slate-500">
              {memories.length} total · {pinned.length} pinned
            </span>
          </h3>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories and past conversations…"
            className={`${fieldCls} w-72`}
          />
        </div>

        {query.trim() && results ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Matching memories</p>
              {results.memories.length === 0 ? (
                <p className="text-xs text-slate-500">No memories matched.</p>
              ) : (
                <ul className="divide-y divide-white/[0.08]">{results.memories.map(renderRow)}</ul>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Matching conversation lines</p>
              {results.conversations.length === 0 ? (
                <p className="text-xs text-slate-500">No past messages matched.</p>
              ) : (
                <ul className="space-y-2">
                  {results.conversations.map((c) => (
                    <li key={c.id} className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge tone={c.channel === 'discord' ? 'warn' : 'neutral'}>{c.channel}</Badge>
                        <span className="text-[11px] text-slate-500">
                          {c.role} · {when(c.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300">{c.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : memories.length === 0 ? (
          <EmptyState
            title="Nothing retained yet"
            hint="Chat with the bot, then hit “Scan conversations” — or add a memory manually above."
          />
        ) : (
          <div className="space-y-5">
            {pinned.length > 0 && (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Pinned (always in context)</p>
                <ul className="divide-y divide-white/[0.08]">{pinned.map(renderRow)}</ul>
              </div>
            )}
            <div>
              {pinned.length > 0 && <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Other</p>}
              <ul className="divide-y divide-white/[0.08]">{rest.map(renderRow)}</ul>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-sm font-semibold text-slate-200">Recent conversation</h3>
        <p className="mb-3 text-xs text-slate-500">
          One merged timeline — the app chat and Discord share this history.
        </p>
        {conversations.length === 0 ? (
          <EmptyState title="No conversation yet" hint="Messages you send in the app or Discord will appear here." />
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {conversations.map((c) => (
              <li key={c.id} className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={c.channel === 'discord' ? 'warn' : 'neutral'}>{c.channel}</Badge>
                  <span className="text-[11px] text-slate-500">
                    {c.role} · {when(c.createdAt)}
                  </span>
                </div>
                <p className="line-clamp-3 text-sm text-slate-300">{c.content}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
