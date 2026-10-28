/** @type {import('tailwindcss').Config} */
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
          950: '#141518',
          900: '#1c1d24',
          850: '#22242c',
          800: '#292b34',
          700: '#353843',
          600: '#454a57'
        },
        accent: {
          DEFAULT: '#3ea6ff',
          dim: '#2b82d6'
        },
        danger: '#f87171',
        warn: '#ffb238'
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
