import { useEffect, useRef, useState } from 'react'
import type { EvidenceItem, ReviewItem } from '../../../api/src/review/contract'
import FitBadge from '../FitBadge'
import { AlertTriangle, CheckCircle, MinusCircle, XCircle, XLogo } from '../icons'
import { chip, tone } from '../ui'
import Frame from './Actions'
import { ModelChecks, PersonFacts } from './PersonFacts'
import { activeLabel, evidenceIdOf, LANGUAGE_NAME, RELATIONSHIP_LABEL, shortDate, sourceLine, type Verdict } from './labels'

// The draft-level check says some post is old; only the old ones get the chip.
const isOld = (postedAt: string | null) => postedAt !== null && Date.now() - Date.parse(postedAt) > 30 * 86_400_000

// What the reviewer clicked to hold in place: a sentence of the draft, or an evidence item.
type Pin = { kind: 'sentence'; i: number } | { kind: 'evidence'; id: number } | null

const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

// Brings an element to the middle of the column that scrolls it. Near the start or the end of the column it cannot reach the
// middle, so it stops at the edge. Without a scrolling column (one-column layout) the page scrolls instead.
function centerIn(box: HTMLElement | null, el: Element | null) {
  if (!box || !el) return
  if (getComputedStyle(box).overflowY === 'visible') {
    el.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
    return
  }
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const top = box.scrollTop + (r.top - b.top) - (b.height - r.height) / 2
  box.scrollTo({ top: Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight)), behavior: scrollBehavior() })
}

function EvidenceList({ evidence, stale, active, onHover, onPick }: {
  evidence: EvidenceItem[]
  stale: boolean
  active: number | null
  onHover: (id: number | null) => void
  onPick: (id: number) => void
}) {
  if (!evidence.length) return <p className="text-sm text-muted">No evidence attached to this draft.</p>
  return (
    <ul className="space-y-4">
      {evidence.map((e) => (
        <li
          key={e.id}
          data-evidence={e.id}
          onMouseEnter={() => onHover(e.id)}
          onMouseLeave={() => onHover(null)}
          onClick={(ev) => !(ev.target as HTMLElement).closest('a') && !window.getSelection()?.toString() && onPick(e.id)}
          className={`-mx-3 cursor-pointer rounded-xl px-3 py-2 transition-colors ${active === e.id ? 'bg-mark' : ''}`}
        >
          <p className="text-[15px] leading-snug">“{e.text}”</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>
              {e.kind === 'post' ? 'Their post' : e.kind === 'inbound_dm' ? 'Their message to you' : 'Their bio'}
              {shortDate(e.postedAt) && ` · ${shortDate(e.postedAt)}`}
            </span>
            {stale && e.kind === 'post' && isOld(e.postedAt) && <span className={`${chip} ${tone.warn.chip}`}>Old post</span>}
            {e.url && (
              <a className="underline underline-offset-4" href={e.url} target="_blank" rel="noreferrer">
                Open on X
              </a>
            )}
          </p>
        </li>
      ))}
    </ul>
  )
}

const STATUS_ICON = { ok: CheckCircle, warn: AlertTriangle, stop: XCircle, done: MinusCircle }

// The verdict as a status mark, away from the buttons so it cannot be mistaken for one.
function StatusChip({ verdict }: { verdict: Verdict }) {
  const Icon = STATUS_ICON[verdict.tone]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tone[verdict.tone].chip}`}>
      <Icon className="size-4" />
      {verdict.headline.replace(/\.$/, '')}
    </span>
  )
}

// The writing rule aims for about 450 characters. Longer text steps the size down, never below 16px, and the card scrolls past that.
const textSize = (chars: number) => (chars <= 240 ? 'text-base leading-relaxed sm:text-xl sm:leading-[1.65]' : chars <= 360 ? 'text-base leading-relaxed sm:text-lg sm:leading-[1.6]' : 'text-base leading-relaxed')

function Draft({ item, shownSentence, setHoverSentence, pinnedSentence, onPick, activeEvidence }: {
  item: ReviewItem
  shownSentence: number | null
  setHoverSentence: (i: number | null) => void
  pinnedSentence: number | null
  onPick: (i: number) => void
  activeEvidence: number | null
}) {
  // What sits between two sentences in the text that will be sent: a space or a line break. Shown as written.
  const gaps = item.sentences.reduce<{ gaps: string[]; at: number }>(
    (acc, s) => {
      const k = item.text.indexOf(s.text, acc.at)
      return k < 0 ? { gaps: [...acc.gaps, ' '], at: acc.at } : { gaps: [...acc.gaps, item.text.slice(acc.at, k)], at: k + s.text.length }
    },
    { gaps: [], at: 0 },
  ).gaps
  return (
    <>
      <p lang={item.language} className={`max-w-[58ch] whitespace-pre-line ${textSize(item.text.length)}`}>
        {item.sentences.map((s, i) => {
          const linked = activeEvidence !== null && evidenceIdOf(s) === activeEvidence
          return (
            <span key={i}>
              {gaps[i]}
              <span
                tabIndex={0}
                role="button"
                aria-pressed={pinnedSentence === i}
                data-sentence={i}
                onMouseEnter={() => setHoverSentence(i)}
                onMouseLeave={() => setHoverSentence(null)}
                onFocus={() => setHoverSentence(i)}
                onBlur={() => setHoverSentence(null)}
                onClick={() => onPick(i)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onPick(i)
                }}
                className={`cursor-pointer rounded-md transition-colors ${shownSentence === i || linked ? 'bg-mark' : ''} ${s.source === null ? 'underline decoration-block decoration-wavy underline-offset-4' : ''}`}
              >
                {s.text}
              </span>
            </span>
          )
        })}
      </p>
      <p className="mt-3 min-h-5 text-sm text-muted" aria-live="polite">
        {shownSentence !== null ? sourceLine(item.sentences[shownSentence], item.evidence) : 'Point at or click a sentence to see where it comes from.'}
      </p>
    </>
  )
}

// Fills its parent. The Frame supplies the toolbar; this is the body: Fit, person, draft, evidence.
export default function DraftView({ item, nav, onFinished }: { item: ReviewItem; nav: React.ReactNode; onFinished: () => void }) {
  const [hoverSentence, setHoverSentence] = useState<number | null>(null)
  const [hoverEvidence, setHoverEvidence] = useState<number | null>(null)
  const [pin, setPin] = useState<Pin>(null)
  const aside = useRef<HTMLElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const p = item.prospect

  const pinnedSentence = pin?.kind === 'sentence' ? pin.i : null
  const pinnedEvidence = pin?.kind === 'evidence' ? pin.id : pin?.kind === 'sentence' ? evidenceIdOf(item.sentences[pin.i]) : null
  const shownSentence = hoverSentence ?? pinnedSentence
  const activeEvidence = hoverEvidence ?? (hoverSentence !== null ? evidenceIdOf(item.sentences[hoverSentence]) : pinnedEvidence)
  const stale = item.checks.some((c) => c.code === 'stale_opening')

  // The bio is shown beside the numbers; it is evidence only when a sentence cites it.
  const cited = new Set(item.sentences.map(evidenceIdOf))
  const evidence = item.evidence.filter((e) => e.kind !== 'bio' || cited.has(e.id))

  useEffect(() => {
    if (pin === null) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && setPin(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pin])

  // A click is ignored while text is selected, so selecting the message to copy it does not pin anything.
  const pickSentence = (i: number) => {
    if (window.getSelection()?.toString()) return
    setPin((cur) => (cur?.kind === 'sentence' && cur.i === i ? null : { kind: 'sentence', i }))
    const id = evidenceIdOf(item.sentences[i])
    if (id !== null) centerIn(aside.current, aside.current?.querySelector(`[data-evidence="${id}"]`) ?? null)
  }

  const pickEvidence = (id: number) => {
    setPin((cur) => (cur?.kind === 'evidence' && cur.id === id ? null : { kind: 'evidence', id }))
    const at = item.sentences.findIndex((s) => evidenceIdOf(s) === id)
    if (at >= 0) centerIn(card.current, card.current?.querySelector(`[data-sentence="${at}"]`) ?? null)
  }

  const profile = `https://x.com/${p.handle}`
  const handleLink = (cls: string) => (
    <a href={profile} target="_blank" rel="noreferrer" title={`Open @${p.handle} on X`} className={`${cls} underline-offset-4 transition-colors hover:text-ink hover:underline`}>
      @{p.handle}
    </a>
  )

  return (
    <Frame key={item.contentHash} item={item} nav={nav} onFinished={onFinished}>
      {(api) => (
        <div className="grid lg:h-full lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
          <div className="scroll-thin min-w-0 px-5 pb-6 pt-6 sm:px-12 lg:overflow-y-auto">
            <header>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <FitBadge fit={p.fit} size="lg" />
                <StatusChip verdict={api.verdict} />
              </div>
              <h2 className="mt-2 text-[28px] font-semibold leading-tight">
                {p.name ?? handleLink('text-ink')}
                {p.name && <span className="ml-3">{handleLink('text-lg font-normal text-muted')}</span>}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {p.history ?? RELATIONSHIP_LABEL[p.relationship]} · {activeLabel(p.daysSinceActive)} · {item.kind === 'reply' ? 'Reply to their message' : 'First message'}
                {item.editedByReviewer && ' · You edited this draft'}
              </p>
            </header>

            <section aria-label="Draft message" className="mt-5 min-w-0">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <XLogo className="size-4" />
                {item.kind === 'reply' ? 'Reply to' : 'Direct message to'} @{p.handle}
                {item.language !== 'en' && <span className="font-normal text-muted">· in {LANGUAGE_NAME[item.language]}</span>}
                {(item.status === 'pending' || item.status === 'approved') && <span className="font-normal text-muted">· not sent yet</span>}
              </p>
              {!api.editing && (
                <>
                  <div ref={card} className="max-h-[min(55vh,420px)] sm:max-h-[min(42vh,360px)] max-w-[62ch] scroll-thin overflow-y-auto rounded-2xl border border-rule bg-paper px-6 py-4">
                    <Draft item={item} shownSentence={shownSentence} setHoverSentence={setHoverSentence} pinnedSentence={pinnedSentence} onPick={pickSentence} activeEvidence={activeEvidence} />
                  </div>
                  {item.englishText !== null && (
                    <div className="mt-3 max-w-[62ch] rounded-2xl bg-rail px-6 py-4">
                      <p className="text-xs font-semibold text-muted">{item.editedByReviewer ? 'English version of the draft before your edit' : 'English version, for you to read. It is not what gets sent.'}</p>
                      <p lang="en" className="mt-1 whitespace-pre-line text-sm leading-snug">
                        {item.englishText}
                      </p>
                    </div>
                  )}
                  <div className="mt-3 max-w-[62ch] text-sm">
                    <p>
                      <span className="font-semibold">Weakest point.</span> {item.weakestPoint}
                    </p>
                    {item.sendPath === 'API_SEND' && <p className="mt-1 text-muted">They messaged you first, so xdm-scout may send this reply for you.</p>}
                  </div>
                </>
              )}
              {api.tools}
            </section>
          </div>

          <aside ref={aside} className="scroll-thin min-w-0 space-y-8 px-5 pb-8 sm:px-12 lg:overflow-y-auto lg:border-l lg:border-rule lg:px-9 lg:py-6">
            <PersonFacts prospect={p} />
            <section aria-label="Evidence">
              <h3 className="mb-3 text-sm font-semibold">Why this opening</h3>
              <EvidenceList evidence={evidence} stale={stale} active={activeEvidence} onHover={setHoverEvidence} onPick={pickEvidence} />
            </section>
            <ModelChecks decisions={item.decisions} sentences={item.sentences} />
          </aside>
        </div>
      )}
    </Frame>
  )
}
