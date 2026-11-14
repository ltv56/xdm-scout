import { useEffect, useRef, useState } from 'react'
import type { Decision, ReviewItem } from '../../../api/src/review/contract'
import { CheckCircle, ChevronDown, QuestionCircle, XCircle } from '../icons'
import { activeLabel, LANGUAGE_NAME, shortDate } from './labels'

type Prospect = ReviewItem['prospect']

// A mark and a colour per state. The word stays for screen readers and the tooltip.
const CRITERION = {
  met: {
    label: 'Met',
    Icon: CheckCircle,
    style: 'bg-ok-bg text-ok font-semibold',
  },
  not_met: {
    label: 'Not met',
    Icon: XCircle,
    style: 'bg-block-bg text-block font-semibold',
  },
  unknown: {
    label: 'Unknown',
    Icon: QuestionCircle,
    style: 'bg-rail text-muted',
  },
}

const CONTRIBUTION = {
  builder: 'Builds things',
  founder: 'Founder',
  researcher: 'Researcher',
  commentator: 'Mostly comments',
  other: 'Other',
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const count = (n: number) => n.toLocaleString('en-US')

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-base font-semibold">
        {value}
        {note && <span className="ml-1.5 text-sm font-normal text-muted">{note}</span>}
      </dd>
    </div>
  )
}

// Brings a panel that has just opened into view in its scrolling column.
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ref.current?.scrollIntoView({
      block: 'nearest',
      behavior: smooth ? 'smooth' : 'auto',
    })
  }, [])
  return ref
}

// What a criterion rests on: the posts the fit step cited, or a plain "nothing says either way".
function CriterionPanel({ criterion }: { criterion: Prospect['criteria'][number] }) {
  const { label } = CRITERION[criterion.status]
  const ref = useReveal()
  return (
    <div ref={ref} role="region" aria-label={`What “${criterion.text}” rests on`} className="mt-3 rounded-2xl border border-rule bg-paper p-4">
      {criterion.evidence.length === 0 ? (
        <>
          <p className="text-sm font-semibold">No post confirms this either way.</p>
          <p className="mt-1 text-xs text-muted">A criterion is only marked met or not met when a second check agrees with the posts it cites.</p>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold text-muted">{label}, based on</p>
          <ul className="mt-2 space-y-3">
            {criterion.evidence.map((e) => (
              <li key={e.id}>
                <p className="text-sm leading-snug">“{e.text}”</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span>
                    {e.kind === 'bio' ? 'Their bio' : e.kind === 'inbound_dm' ? 'Their message to you' : 'Their post'}
                    {shortDate(e.postedAt) && ` · ${shortDate(e.postedAt)}`}
                  </span>
                  {e.url && (
                    <a className="underline underline-offset-4" href={e.url} target="_blank" rel="noreferrer">
                      Open on X
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// Counts from the posts we read, with the sample size and date. Never one combined score.
export function PersonFacts({ prospect }: { prospect: Prospect }) {
  const s = prospect.snapshot
  const name = prospect.name ?? `@${prospect.handle}`
  const [open, setOpen] = useState<number | null>(null)
  return (
    <section aria-label="About this person">
      <h3 className="text-sm font-semibold">About {name}</h3>
      <p className="mt-1 text-sm text-muted">
        Counted from the {s.sampleSize} latest posts we read, on {day(s.asOf)}.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        <Fact label="Followers" value={count(s.followers)} />
        <Fact label="Posts per week" value={s.postsPerWeek === null ? 'Not enough posts' : String(s.postsPerWeek)} />
        <Fact
          label="Typical reactions"
          value={s.engagementMedian === null ? 'Not enough posts' : String(s.engagementMedian)}
          note={s.engagementMedian === null ? undefined : 'per post, median'}
        />
        <Fact label="Kind of work" value={CONTRIBUTION[s.contribution]} />
        <Fact label="Followed by our seeds" value={String(s.fundTies)} />
        <Fact label="Last active" value={activeLabel(prospect.daysSinceActive).replace('Active ', '')} />
        {prospect.mainLanguage && <Fact label="Writes mostly in" value={LANGUAGE_NAME[prospect.mainLanguage]} />}
      </dl>
      {prospect.bio && (
        <div className="mt-5">
          <p className="text-sm text-muted">Bio</p>
          <p className="mt-0.5 text-sm leading-snug">“{prospect.bio}”</p>
        </div>
      )}
      {prospect.criteria.length > 0 && (
        <ul className="mt-5 space-y-2" aria-label="Fund criteria">
          {prospect.criteria.map((c, i) => {
            const { label, Icon, style } = CRITERION[c.status]
            return (
              <li key={c.text}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    title={`${label}. Click to see what it rests on.`}
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                    className={`inline-flex max-w-full items-start gap-1.5 rounded-2xl px-2.5 py-1 text-left text-xs transition-shadow hover:shadow-soft ${style} ${open === i ? 'ring-2 ring-ink/30' : ''}`}
                  >
                    <Icon className="mt-px size-3.5 shrink-0" />
                    <span>
                      <span className="sr-only">{label}: </span>
                      {c.text}
                    </span>
                  </button>
                  {c.fact && <span className="text-xs text-muted">{c.fact}</span>}
                </div>
                {open === i && <CriterionPanel criterion={c} />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Who answers each question (spec section 12). A fixture answer stands in for that model, so the row looks the way it will.
const LLM_QUESTIONS = new Set<Decision['code']>(['claim_backed', 'own_account'])
const ANSWERER = { jev: 'AI', llm: 'AI' }
const whoAnswers = (d: Decision): 'jev' | 'llm' => (d.answeredBy === 'fixture' ? (LLM_QUESTIONS.has(d.code) ? 'llm' : 'jev') : d.answeredBy)

// The colour shows what the app does with the number, not just how big it is.
const BAND = {
  high: { bar: 'bg-fit-strong', say: 'Counts as yes', short: 'Yes' },
  middle: {
    bar: 'bg-fit-possible',
    say: 'Unsure, so check it yourself',
    short: 'Unsure',
  },
  low: { bar: 'bg-fit-not', say: 'Counts as no', short: 'No' },
}
const WORST_FIRST = { low: 0, middle: 1, high: 2 }
const pctOf = (x: number) => Math.round(x * 100)

function CheckDetail({ d }: { d: Decision }) {
  const ref = useReveal()
  return (
    <div ref={ref} className="mb-2 rounded-2xl border border-rule bg-paper p-4">
      <p className="text-xs font-semibold text-muted">Given to the model</p>
      <p className="scroll-thin mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-snug [overflow-wrap:anywhere]">{d.input}</p>
      <p className="mt-3 text-xs text-muted">
        Answer: {whoAnswers(d) === 'jev' ? `${pctOf(d.probability)}% yes. ` : ''}
        {BAND[d.band].say}. From {ANSWERER[whoAnswers(d)]}.
      </p>
    </div>
  )
}

// A percentage bar when the figure can be trusted as a chance; three blocks with one lit otherwise, so it never looks like a measured number.
function Meter({ d }: { d: Decision }) {
  if (whoAnswers(d) === 'jev') {
    return (
      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-rail" role="img" aria-label={`${pctOf(d.probability)}% yes`}>
        <span className={`block h-full ${BAND[d.band].bar}`} style={{ width: `${pctOf(d.probability)}%` }} />
      </span>
    )
  }
  const at = { low: 0, middle: 1, high: 2 }[d.band]
  return (
    <span className="mt-1.5 grid grid-cols-3 gap-1" role="img" aria-label={BAND[d.band].say} title="Left: no. Middle: unsure. Right: yes.">
      {[0, 1, 2].map((n) => (
        <span key={n} className={`h-1.5 rounded-full ${n === at ? BAND[d.band].bar : 'bg-rail'}`} />
      ))}
    </span>
  )
}

// Yes/no answers from the decision model. A probability only, so there is no reason text to trust or doubt;
// what it was given is shown instead, so the number can be judged against what the model saw.
export function ModelChecks({ decisions, sentences }: { decisions: Decision[]; sentences: { text: string }[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!decisions.length) return null
  const sorted = [...decisions].sort((a, b) => WORST_FIRST[a.band] - WORST_FIRST[b.band])
  return (
    <section aria-label="Model checks">
      <h3 className="text-sm font-semibold">Model checks</h3>
      <p className="mt-1 text-sm text-muted">
        Some checks show the chance that the answer is yes. Others show only a band: three blocks, no, unsure and yes from left to right, and the lit one is the AI's answer. Neither replaces the checks above.
      </p>
      <p className="mt-1 text-xs text-muted">70% or more counts as yes, 30% or less counts as no, in between is a warning.</p>
      <ul className="mt-3 space-y-1">
        {sorted.map((d) => {
          const key = `${d.code}-${d.sentence ?? ''}`
          const isOpen = open === key
          const quote = d.sentence === null ? null : sentences[d.sentence]?.text
          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : key)}
                className="-mx-3 block w-[calc(100%+1.5rem)] rounded-xl px-3 py-2 text-left transition-colors hover:bg-rail"
              >
                <span className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 text-sm">
                    {d.question}
                    {quote && <span className="mt-0.5 block truncate text-xs text-muted">“{quote}”</span>}
                  </span>
                  <span className="shrink-0 text-base font-semibold">{whoAnswers(d) === 'jev' ? `${pctOf(d.probability)}%` : BAND[d.band].short}</span>
                </span>
                <Meter d={d} />
                <span className="mt-1 flex items-center justify-between text-xs text-muted">
                  <span>
                    {ANSWERER[whoAnswers(d)]}
                  </span>
                  <ChevronDown className={`size-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {isOpen && <CheckDetail d={d} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
