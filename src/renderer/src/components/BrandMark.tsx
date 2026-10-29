/**
 * The FinanceBot brand mark: an electric-blue rounded square with three
 * ascending bars. The same geometry is used for the window/executable icon in
 * `build/icon.png` / `build/icon.ico`, so the app chrome and the taskbar match.
 */
export default function BrandMark({ className = 'h-8 w-8' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="fb-mark-fill" x1="6" y1="2" x2="58" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8fd2ff" />
          <stop offset="38%" stopColor="#3ea6ff" />
          <stop offset="100%" stopColor="#1769d2" />
        </linearGradient>
        <linearGradient id="fb-mark-sheen" x1="12" y1="4" x2="34" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#fb-mark-fill)" />
      <path d="M16 0h32c8.8 0 16 7.2 16 16v6C56 10 40 2 16 2H0C0 .9.9 0 2 0h14z" fill="url(#fb-mark-sheen)" />
      <rect x="15" y="37" width="7" height="13" rx="3.5" fill="#ffffff" opacity="0.82" />
      <rect x="28.5" y="28" width="7" height="22" rx="3.5" fill="#ffffff" opacity="0.92" />
      <rect x="42" y="17" width="7" height="33" rx="3.5" fill="#ffffff" />
      <circle cx="52.5" cy="13.5" r="2.8" fill="#e6f6ff" />
    </svg>
  )
}
