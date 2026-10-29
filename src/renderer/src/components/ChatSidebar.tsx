import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { aiProviderPreset } from '@shared/ai-providers'

export default function ChatSidebar({ onDataChanged }: { onDataChanged: () => void }): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [providerLabel, setProviderLabel] = useState('AI advisor')
  const [toolActions, setToolActions] = useState<
    Array<{ name: string; summary: string; actionId?: number; undone?: boolean }>
  >([])
  const [awaiting, setAwaiting] = useState(false)
  const [open, setOpen] = useState(() => localStorage.getItem('fb_chat_open') !== 'false')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.getChatHistory().then(setMessages)
    window.api
      .getMaskedSettings()
      .then((m) => setProviderLabel(aiProviderPreset(m.AI_PROVIDER).label))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const offToken = window.api.onChatToken((t) => setStreaming((p) => p + t))
    const offReasoning = window.api.onChatReasoning((t) => setReasoning((p) => p + t))
    const offTool = window.api.onChatTool((payload) => setToolActions((prev) => [...prev, payload]))
    const offDone = window.api.onChatDone((full) => {
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), role: 'assistant', content: full, createdAt: Date.now() }
      ])
      setStreaming('')
      setReasoning('')
      setAwaiting(false)
      onDataChanged()
    })
    const offError = window.api.onChatError((msg) => {
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), role: 'assistant', content: `⚠️ ${msg}`, createdAt: Date.now() }
      ])
      setStreaming('')
      setReasoning('')
      setAwaiting(false)
    })
    return () => {
      offToken()
      offReasoning()
      offTool()
      offDone()
      offError()
    }
  }, [onDataChanged])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, streaming, reasoning])

  const send = (): void => {
    const text = input.trim()
    if (!text || awaiting) return
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: 'user', content: text, createdAt: Date.now() }
    ])
    setInput('')
    setAwaiting(true)
    setStreaming('')
    setReasoning('')
    setToolActions([])
    window.api.sendChat(text)
  }

  const clear = async (): Promise<void> => {
    await window.api.clearChat()
    setMessages([])
    setStreaming('')
    setReasoning('')
  }

  const undo = async (index: number): Promise<void> => {
    const action = toolActions[index]
    if (!action?.actionId) return
    const result = await window.api.undoAiAction(action.actionId)
    if (result.ok) {
      setToolActions((prev) => prev.map((a, i) => (i === index ? { ...a, undone: true } : a)))
      onDataChanged()
    }
  }

  const quickPrompts = [
    'How is my budget tracking this month?',
    'Am I on track to overspend before payday?',
    'What subscriptions am I paying for?',
    'Suggest budget adjustments'
  ]

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true)
          localStorage.setItem('fb_chat_open', 'true')
        }}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-surface-950 shadow-[0_0_16px_rgba(62,166,255,0.4)] transition-all hover:bg-accent/90 hover:shadow-[0_0_24px_rgba(62,166,255,0.6)]"
        title="Open AI Advisor"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-1 5h2v6h-2zm0 7h2v2h-2z" />
        </svg>
        AI Advisor
      </button>
    )
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-white/[0.12] bg-white/[0.04] backdrop-blur-[20px] backdrop-saturate-[1.8]">
      <div className="flex items-center justify-between border-b border-white/[0.12] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-1 5h2v6h-2zm0 7h2v2h-2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">AI Advisor</p>
            <p className="text-[10px] text-slate-500">{providerLabel} · reads your data</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clear}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/[0.08] hover:text-slate-300"
          >
            Clear
          </button>
          <button
            onClick={() => {
              setOpen(false)
              localStorage.setItem('fb_chat_open', 'false')
            }}
            title="Collapse AI Advisor"
            className="rounded-md px-1.5 py-1 text-slate-500 hover:bg-white/[0.08] hover:text-slate-300"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !streaming && (
          <div className="space-y-2">
            <p className="text-sm text-slate-400">Ask me anything about your money.</p>
            {quickPrompts.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setInput(q)
                }}
                className="block w-full rounded-[14px] border border-white/[0.16] bg-white/[0.04] px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/[0.08]"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-accent text-surface-950'
                  : 'bg-white/[0.06] text-slate-200 border border-white/[0.12]'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {toolActions.map((ta, i) => (
          <div key={i} className="flex justify-start">
            <div className="flex max-w-[85%] items-center gap-2 rounded-xl bg-accent/10 px-3 py-1.5 text-xs text-accent">
              <span className="min-w-0">
                {ta.undone ? '↩ Undone — ' : '🔧 '}
                {ta.summary}
              </span>
              {ta.actionId && !ta.undone && (
                <button
                  onClick={() => void undo(i)}
                  className="shrink-0 rounded-full border border-accent/30 px-2 py-0.5 text-[10px] text-accent hover:bg-accent/20"
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        ))}

        {reasoning && (
          <div className="flex justify-start">
            <details className="max-w-[85%] rounded-2xl border border-white/[0.12] bg-white/[0.06] px-3 py-2 text-xs text-slate-400" open={awaiting}>
              <summary className="cursor-pointer select-none font-medium text-slate-500">
                {awaiting ? '🧠 Reasoning…' : '🧠 Reasoning'}
              </summary>
              <div className="mt-1 whitespace-pre-wrap">{reasoning}</div>
            </details>
          </div>
        )}

        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-white/[0.06] px-3 py-2 text-sm text-slate-200 border border-white/[0.12]">
              {streaming}
              <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-slate-400" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.12] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="Ask about budgets, spending, insurance…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-[14px] border border-white/[0.12] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-accent focus:outline-none"
          />
          <button
            onClick={send}
            disabled={awaiting || !input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-surface-950 transition-colors hover:bg-accent/90 disabled:opacity-40"
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
