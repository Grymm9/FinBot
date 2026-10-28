import type { ReactNode } from 'react'

export function Card({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={`glass glass-hover rounded-3xl p-6 ${className}`}>
      {children}
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-surface-950 border border-white/40 shadow-[0_0_16px_rgba(62,166,255,0.4)] hover:bg-accent/90 hover:shadow-[0_0_24px_rgba(62,166,255,0.6)] disabled:opacity-40',
  secondary:
    'glass glass-hover text-slate-100 disabled:opacity-40',
  danger: 'bg-danger/15 text-danger border border-white/10 hover:bg-danger/25 disabled:opacity-40',
  ghost: 'text-slate-300 hover:bg-white/[0.06] disabled:opacity-40'
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className = '',
  type = 'button'
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}): JSX.Element {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}): JSX.Element {
  const tones = {
    neutral: 'glass text-slate-300',
    good: 'bg-accent/15 text-accent border border-accent/30',
    warn: 'bg-warn/15 text-warn border border-warn/30',
    bad: 'bg-danger/15 text-danger border border-danger/30'
  }
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function ProgressBar({
  percent,
  tone = 'auto'
}: {
  percent: number
  tone?: 'auto' | 'good' | 'warn' | 'bad'
}): JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent))
  const color =
    tone === 'auto'
      ? percent > 100
        ? 'bg-danger'
        : 'bg-accent'
      : tone === 'good'
        ? 'bg-accent'
        : tone === 'warn'
          ? 'bg-warn'
          : 'bg-danger'
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.1]">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function SectionHeader({
  title,
  subtitle,
  action
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent ${className}`}
    />
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/[0.16] bg-white/[0.04] py-12 text-center backdrop-blur-[20px] backdrop-saturate-[1.8]">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral'
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'good' | 'bad'
}): JSX.Element {
  const valueColor = tone === 'good' ? 'text-accent' : tone === 'bad' ? 'text-danger' : 'text-slate-100'
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </Card>
  )
}
