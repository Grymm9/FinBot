/** @type {import('tailwindcss').Config} */

// Every themed colour points at a CSS variable (defined per theme in
// src/renderer/src/index.css). The `<alpha-value>` placeholder keeps Tailwind's
// opacity modifiers working, e.g. `bg-white/[0.06]` becomes
// `rgb(var(--fb-white) / 0.06)`, so switching themes repaints the whole app
// without touching component markup.
const token = (name) => `rgb(var(--fb-${name}) / <alpha-value>)`

module.exports = {
  darkMode: 'class',
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Opaque frosted-glass palette (dark charcoal base, per design.md)
        surface: {
          950: token('surface-950'),
          900: token('surface-900'),
          850: token('surface-850'),
          800: token('surface-800'),
          700: token('surface-700'),
          600: token('surface-600')
        },
        accent: {
          DEFAULT: token('accent'),
          dim: token('accent-dim')
        },
        danger: '#f87171',
        warn: '#ffb238',
        // Remapped per theme: light themes turn "white overlays" into ink.
        white: token('white'),
        slate: {
          100: token('slate-100'),
          200: token('slate-200'),
          300: token('slate-300'),
          400: token('slate-400'),
          500: token('slate-500'),
          600: token('slate-600')
        }
      },
      borderRadius: {
        sm: '8px',
        md: '14px',
        pill: '999px'
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif'
        ]
      }
    }
  },
  plugins: []
}
