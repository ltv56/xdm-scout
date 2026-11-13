import { useEffect, useRef, useState } from 'react'
import { More } from '../icons'

// Rare, hard-to-undo actions live here so they are never next to Approve.
export default function MoreMenu({ handle, onDoNotContact }: { handle: string; onDoNotContact: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

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
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-rail hover:text-ink"
      >
        <More className="size-5" />
      </button>
      {open && (
        <div role="menu" aria-label="More actions" className="absolute right-0 top-full z-30 mt-2 w-max max-w-[min(320px,calc(100vw-3rem))] rounded-2xl bg-raised p-1.5 shadow-pop">
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setOpen(false)
              onDoNotContact()
            }}
            className="w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-rail hover:text-block"
          >
            Do not contact @{handle}
          </button>
        </div>
      )}
    </div>
  )
}
