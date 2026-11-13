export type FitValue = 'strong' | 'possible' | 'weak' | 'not_a_fit' | 'no_basis' | null

const LABEL: Record<NonNullable<FitValue>, string> = {
  strong: 'Strong fit',
  possible: 'Possible fit',
  weak: 'Weak fit',
  not_a_fit: 'Not a fit',
  no_basis: 'Not enough to judge',
}

const TEXT: Record<NonNullable<FitValue> | 'unscored', string> = {
  strong: 'text-ok',
  possible: 'text-warn',
  weak: 'text-muted',
  not_a_fit: 'text-block',
  no_basis: 'text-muted',
  unscored: 'text-muted',
}

// Fit as a small gauge: full circle, half circle, empty ring. The words always sit beside it.
export function FitMark({ fit, size = 16 }: { fit: FitValue; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 20 20', 'aria-hidden': true } as const
  if (fit === 'strong') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="9" fill="var(--fit-strong)" />
      </svg>
    )
  }
  if (fit === 'possible') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--fit-possible)" strokeWidth="2" />
        <path d="M10 1a9 9 0 0 0 0 18Z" fill="var(--fit-possible)" />
      </svg>
    )
  }
  if (fit === 'weak') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="8" fill="none" stroke="#9a9aa3" strokeWidth="2" />
      </svg>
    )
  }
  if (fit === 'not_a_fit') {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--fit-not)" strokeWidth="2" />
        <path d="M5.5 14.5l9-9" stroke="var(--fit-not)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="8" fill="none" stroke="#b8b8c0" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  )
}

export default function FitBadge({ fit, size = 'sm' }: { fit: FitValue; size?: 'sm' | 'lg' }) {
  const lg = size === 'lg'
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold ${lg ? 'text-lg' : 'text-sm'} ${TEXT[fit ?? 'unscored']}`}>
      <FitMark fit={fit} size={lg ? 22 : 16} />
      {fit ? LABEL[fit] : 'Not scored'}
    </span>
  )
}
