// Chevrons, status marks and two edit tools, one stroke weight, drawn for this app.
type IconProps = { className?: string }

const base = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const ChevronLeft = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12.5 4.5 7 10l5.5 5.5" />
  </svg>
)

export const ChevronRight = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M7.5 4.5 13 10l-5.5 5.5" />
  </svg>
)

export const ChevronDown = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M5 7.5 10 12.5l5-5" />
  </svg>
)

export const CheckCircle = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m6.6 10.2 2.3 2.3 4.5-4.8" />
  </svg>
)

export const AlertTriangle = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M10 3.3 17.4 16H2.6Z" />
    <path d="M10 8.2v3.4M10 13.9h.01" />
  </svg>
)

export const XCircle = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m7.4 7.4 5.2 5.2M12.6 7.4l-5.2 5.2" />
  </svg>
)

export const MinusCircle = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M6.8 10h6.4" />
  </svg>
)

export const Pencil = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m3.6 16.4.8-3.4 8.9-8.9a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L7.4 16Z" />
    <path d="m11.9 5.6 2.5 2.5" />
  </svg>
)

export const Refresh = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M16.4 10a6.4 6.4 0 1 1-1.9-4.5" />
    <path d="M16.4 3.9v3.5H12.9" />
  </svg>
)

export const Globe = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="10" cy="10" r="7" />
    <path d="M3 10h14" />
    <path d="M10 3c2.3 2 2.3 12 0 14" />
    <path d="M10 3c-2.3 2-2.3 12 0 14" />
  </svg>
)

// The X mark, filled, for "Open in X". Drawn on a 24 grid so it reads at 16px.
export const XLogo = ({ className }: IconProps) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

export const Check = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </svg>
)

export const Plus = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
)

export const User = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="10" cy="7" r="3" />
    <path d="M4 16.5c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" />
  </svg>
)

export const Copy = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="7" y="7" width="9" height="9" rx="2" />
    <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
  </svg>
)

export const More = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="4.5" cy="10" r="1" fill="currentColor" />
    <circle cx="10" cy="10" r="1" fill="currentColor" />
    <circle cx="15.5" cy="10" r="1" fill="currentColor" />
  </svg>
)

export const QuestionCircle = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M7.9 8a2.2 2.2 0 1 1 3.3 1.9c-.8.4-1.2.9-1.2 1.7" />
    <circle cx="10" cy="14" r=".6" fill="currentColor" />
  </svg>
)
