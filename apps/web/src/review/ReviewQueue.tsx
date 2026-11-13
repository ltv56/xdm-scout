import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ReviewItem, ReviewQueue as Queue } from '../../../api/src/review/contract'
import { getJson } from '../api'
import { FitMark } from '../FitBadge'
import { ChevronDown, ChevronLeft, ChevronRight } from '../icons'
import { chip, tone } from '../ui'
import DraftView from './DraftView'
import { isDone, verdict } from './labels'

const arrow = 'grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-rail disabled:text-rule disabled:hover:bg-transparent'

// Previous / next arrows and a name that opens the whole queue as a list.
function DraftNav({ items, index, onSelect }: { items: ReviewItem[]; index: number; onSelect: (i: number) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const current = items[index]

  const moveFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = Array.from(list.current?.querySelectorAll('button') ?? [])
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={box} className="relative flex items-center gap-0.5">
      <button type="button" className={arrow} aria-label="Previous draft" disabled={index === 0} onClick={() => onSelect(index - 1)}>
        <ChevronLeft />
      </button>
      <button type="button" className={arrow} aria-label="Next draft" disabled={index === items.length - 1} onClick={() => onSelect(index + 1)}>
        <ChevronRight />
      </button>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="ml-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-rail"
      >
        <span className="font-semibold">{current.prospect.name ?? `@${current.prospect.handle}`}</span>
        <span className="text-muted">
          {index + 1} of {items.length}
        </span>
        <ChevronDown className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul ref={list} onKeyDown={moveFocus} aria-label="Drafts" className="absolute left-0 top-full z-20 mt-2 max-h-[60vh] w-[min(380px,calc(100vw-5rem))] overflow-y-auto rounded-2xl bg-raised p-1.5 shadow-pop">
          {items.map((i, n) => {
            const v = verdict(i)
            return (
              <li key={i.draftId}>
                <button
                  type="button"
                  autoFocus={n === index}
                  aria-current={n === index}
                  onClick={() => {
                    onSelect(n)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-rail ${n === index ? 'bg-rail' : ''} ${isDone(i) ? 'text-muted' : ''}`}
                >
                  <FitMark fit={i.prospect.fit} size={16} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-semibold">{i.prospect.name ?? `@${i.prospect.handle}`}</span>
                    {i.prospect.name && <span className="text-muted"> @{i.prospect.handle}</span>}
                  </span>
                  <span className={`${chip} ${tone[v.tone].chip}`}>{v.chip}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Fills the panel it is placed in.
export default function ReviewQueue({ campaignId }: { campaignId: number }) {
  const { data, error, isLoading } = useQuery<Queue>({
    queryKey: ['review-queue', campaignId],
    queryFn: () => getJson(`/review-queue?campaignId=${campaignId}`),
  })
  const [selected, setSelected] = useState<number | null>(null)

  const items = data?.items ?? []
  const index = Math.max(0, items.findIndex((i) => i.draftId === selected))
  const current = items[index]

  const go = (to: number) => items[to] && setSelected(items[to].draftId)
  const nextPending = () => {
    const after = [...items.slice(index + 1), ...items.slice(0, index)].find((i) => i.status === 'pending')
    if (after) setSelected(after.draftId)
  }

  // Only the left and right arrows, and only for moving. They are ignored while typing, while a dialog is open and while
  // the edit or rewrite form is open, so moving on can never throw away text being written.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const el = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return
      if (document.querySelector('dialog[open]') || document.getElementById('edit-text') || document.getElementById('regen-note')) return
      go(e.key === 'ArrowRight' ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (isLoading) return <p className="px-12 py-10 text-sm text-muted">Loading drafts…</p>
  if (error) return <p role="alert" className="px-12 py-10 text-sm font-medium text-block">{error.message}</p>
  if (!current) {
    return (
      <div className="max-w-md px-12 py-10">
        <h2 className="text-lg font-semibold">Nothing to review</h2>
        <p className="mt-1 text-sm text-muted">Drafts appear here after discovery finds people with a recent post to open with. Run a search from the Overview.</p>
      </div>
    )
  }

  return <DraftView key={current.draftId} item={current} nav={<DraftNav items={items} index={index} onSelect={go} />} onFinished={nextPending} />
}
