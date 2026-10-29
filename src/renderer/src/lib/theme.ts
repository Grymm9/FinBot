/**
 * Theme registry + persistence.
 *
 * The palettes themselves live in `index.css` under `[data-theme='…']`; this
 * module only knows the ids, their marketing names and preview colours. Theme
 * is a per-machine UI preference, so it is stored in localStorage rather than
 * the synced database.
 */

export type ThemeId = 'dark-blue-glass' | 'porcelain-light' | 'midnight-neon'

export interface ThemeOption {
  id: ThemeId
  name: string
  description: string
  /** Preview colours (fixed per theme, independent of the active palette). */
  preview: {
    background: string
    glass: string
    border: string
    accent: string
    text: string
  }
}

export const DEFAULT_THEME: ThemeId = 'dark-blue-glass'

export const THEMES: ThemeOption[] = [
  {
    id: 'dark-blue-glass',
    name: 'Dark Blue Glass',
    description: 'Charcoal frosted glass with the original electric-blue accent.',
    preview: {
      background: 'radial-gradient(circle at 80% 20%, #1d3550 0%, #14151a 62%)',
      glass: 'rgba(255,255,255,0.08)',
      border: 'rgba(255,255,255,0.2)',
      accent: '#3ea6ff',
      text: '#f5f5f2'
    }
  },
  {
    id: 'porcelain-light',
    name: 'Porcelain Light',
    description: 'Daylight glass, ink text and a deeper blue accent for bright rooms.',
    preview: {
      background: 'radial-gradient(circle at 80% 20%, #dbeafe 0%, #eef2f8 65%)',
      glass: 'rgba(255,255,255,0.72)',
      border: 'rgba(15,23,42,0.18)',
      accent: '#0f6ecd',
      text: '#0f172a'
    }
  },
  {
    id: 'midnight-neon',
    name: 'Midnight Neon',
    description: 'Violet-black backdrop with cyan highlights and a magenta wash.',
    preview: {
      background:
        'radial-gradient(circle at 82% 18%, rgba(34,211,238,0.35) 0%, transparent 55%), radial-gradient(circle at 16% 86%, rgba(217,70,239,0.32) 0%, transparent 55%), #0b0716',
      glass: 'rgba(255,255,255,0.07)',
      border: 'rgba(196,181,253,0.28)',
      accent: '#22d3ee',
      text: '#f3ecff'
    }
  }
]

const STORAGE_KEY = 'financebot.theme.v1'

function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}

export function getStoredTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isThemeId(raw) ? raw : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** Paint the theme immediately (called before the first render). */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement
  root.dataset.theme = id
  root.style.colorScheme = id === 'porcelain-light' ? 'light' : 'dark'
}

export function setTheme(id: ThemeId): void {
  applyTheme(id)
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage can be unavailable in hardened renderers; the theme still applies
    // for this session.
  }
}
