import { useEffect, useState } from 'react'
import type { CardMapping, Category, CategoryRule, UnmatchedMerchant } from '@shared/types'
import { Badge, Button, Card, EmptyState, SectionHeader } from './ui'
import { money } from '../lib/format'

export default function Mapping({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [merchants, setMerchants] = useState<UnmatchedMerchant[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [cards, setCards] = useState<CardMapping[]>([])
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [newCard, setNewCard] = useState('')
  const [newCardCat, setNewCardCat] = useState('')

  const load = async (): Promise<void> => {
    const [m, c, r, cm] = await Promise.all([
      window.api.listUnmatchedMerchants(),
      window.api.listCategories(),
      window.api.listRules(),
      window.api.listCardMappings()
    ])
    setMerchants(m)
    setCategories(c)
    setRules(r)
    setCards(cm)
  }

  useEffect(() => {
    load()
  }, [])

  const assign = async (key: string): Promise<void> => {
    const cat = selected[key]
    if (!cat) return
    setRules(await window.api.addRule(key, cat))
    const next = { ...selected }
    delete next[key]
    setSelected(next)
    await load()
    onChanged()
  }

  const removeRule = async (id: number): Promise<void> => {
    setRules(await window.api.removeRule(id))
    await load()
    onChanged()
  }

  const addCardMapping = async (): Promise<void> => {
    if (!newCard.trim() || !newCardCat) return
    setCards(await window.api.setCardMapping(newCard.trim(), newCardCat))
    setNewCard('')
    setNewCardCat('')
    await load()
    onChanged()
  }

  const removeCardMapping = async (card: string): Promise<void> => {
    setCards(await window.api.removeCardMapping(card))
    await load()
    onChanged()
  }

  const selectCls =
    'rounded-md border border-white/[0.16] bg-white/[0.06] px-2 py-1 text-sm text-slate-100 focus:border-accent focus:outline-none'

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Transaction mapping"
        subtitle="Assign merchants to budget categories. Rules apply automatically to future transactions."
      />

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">
          Uncategorised merchants this cycle
        </h3>
        {merchants.length === 0 ? (
          <EmptyState
            title="Everything is categorised 🎉"
            hint="No unmatched spending this cycle — or you may need to sync/refresh."
          />
        ) : (
          <ul className="divide-y divide-surface-800">
            {merchants.map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{m.label}</p>
                  <p className="text-xs text-slate-500">
                    {m.count}× · {money(m.total)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={selected[m.key] ?? ''}
                    onChange={(e) => setSelected({ ...selected, [m.key]: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">Map to…</option>
                    {categories.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => assign(m.key)} disabled={!selected[m.key]}>
                    Save
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Existing rules</h3>
        {rules.length === 0 ? (
          <p className="text-sm text-slate-500">No mapping rules yet.</p>
        ) : (
          <ul className="divide-y divide-surface-800">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-300">{r.keyword}</span>
                  <span className="text-slate-600">→</span>
                  <Badge tone="good">{r.category}</Badge>
                </div>
                <button
                  onClick={() => removeRule(r.id)}
                  className="text-xs text-slate-500 hover:text-danger"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Card → envelope mappings</h3>
        <p className="mb-3 text-xs text-slate-500">
          Pin a physical card number (e.g. 0759) to an envelope so its transactions resolve correctly even when the
          merchant text is unrecognised.
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-400">
            Card number
            <input
              value={newCard}
              onChange={(e) => setNewCard(e.target.value)}
              placeholder="0759"
              className="mt-1 block w-28 rounded-md border border-white/[0.16] bg-white/[0.06] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
            />
          </label>
          <label className="text-xs text-slate-400">
            Envelope
            <select
              value={newCardCat}
              onChange={(e) => setNewCardCat(e.target.value)}
              className={selectCls}
            >
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={addCardMapping} disabled={!newCard.trim() || !newCardCat}>
            Add
          </Button>
        </div>
        {cards.length === 0 ? (
          <p className="text-sm text-slate-500">No card mappings yet.</p>
        ) : (
          <ul className="divide-y divide-surface-800">
            {cards.map((m) => (
              <li key={m.card} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-300">Card {m.card}</span>
                  <span className="text-slate-600">→</span>
                  <Badge tone="good">{m.category}</Badge>
                </div>
                <button
                  onClick={() => removeCardMapping(m.card)}
                  className="text-xs text-slate-500 hover:text-danger"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
