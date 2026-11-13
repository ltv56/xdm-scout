import { useEffect, useRef, useState } from 'react'
import type { CampaignSummary } from '../../api/src/review/contract'
import { Check, ChevronDown, Plus } from './icons'

// Which campaign the app is showing, and the way to start another. A list rather than a native select so the
// current one reads as a control and "New campaign" sits with the others.
export default function CampaignPicker({ list, active, onSelect, onNew }: {
  list: CampaignSummary[]
  active: number | null
  onSelect: (id: number) => void
  onNew: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const current = list.find((c) => c.id === active)

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

  const moveFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = Array.from(menu.current?.querySelectorAll('button') ?? [])
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
  }

  const row = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-rail'

  return (
    <div ref={box} className="relative min-w-0 max-w-full" title="A campaign is one search for people to message: who to look at, your criteria and a budget. Prospects and drafts belong to it.">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={!list.length}
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-2 rounded-xl bg-raised px-3.5 py-2 text-sm shadow-soft transition-colors hover:bg-rail"
      >
        <span className="shrink-0 text-muted">Campaign</span>
        <span className="min-w-0 truncate font-semibold">{current?.name ?? 'None yet'}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul ref={menu} onKeyDown={moveFocus} aria-label="Campaigns" className="absolute left-0 top-full z-30 lg:left-auto lg:right-0 mt-2 max-h-[60vh] w-[min(340px,calc(100vw-3rem))] overflow-y-auto rounded-2xl bg-raised p-1.5 shadow-pop">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                autoFocus={c.id === active}
                aria-current={c.id === active}
                onClick={() => {
                  onSelect(c.id)
                  setOpen(false)
                }}
                className={`${row} ${c.id === active ? 'bg-rail' : ''}`}
              >
                <span className={`min-w-0 flex-1 truncate ${c.id === active ? 'font-semibold' : ''}`}>{c.name}</span>
                {c.id === active && <Check className="size-4 shrink-0" />}
              </button>
            </li>
          ))}
          <li className="mt-1.5 border-t border-rule pt-1.5">
            <button
              type="button"
              className={row}
              onClick={() => {
                onNew()
                setOpen(false)
              }}
            >
              <Plus className="size-4 shrink-0" />
              <span className="font-medium">New campaign</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
