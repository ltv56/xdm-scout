// Shared class strings so every screen uses the same buttons, fields and chips.
export const btnPrimary =
  'rounded-lg bg-accent px-6 py-2.5 text-base font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:bg-rail disabled:text-muted'
export const btnSecondary = 'rounded-lg bg-rail px-4 py-2 text-sm font-medium transition-colors hover:bg-rule disabled:text-muted'
export const btnToolbar = 'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-rail disabled:text-muted'
export const btnApprove =
  'inline-flex items-center rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:bg-rail disabled:text-muted'
export const btnLink = 'text-sm font-medium underline decoration-rule decoration-2 underline-offset-4 transition-colors hover:decoration-ink'
export const field = 'w-full rounded-xl border border-rule bg-raised px-3.5 py-2.5 text-sm'
export const chip = 'rounded-full px-2.5 py-0.5 text-xs font-semibold'
export const card = 'rounded-2xl bg-raised shadow-soft'

export type Tone = 'ok' | 'warn' | 'stop' | 'done'

export const tone: Record<Tone, { chip: string; text: string }> = {
  ok: { chip: 'bg-ok-bg text-ok', text: 'text-ok' },
  warn: { chip: 'bg-warn-bg text-warn', text: 'text-warn' },
  stop: { chip: 'bg-block-bg text-block', text: 'text-block' },
  done: { chip: 'bg-rail text-muted', text: 'text-ink' },
}

export const money = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`
