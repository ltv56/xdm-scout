import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { CampaignLane, ReadyToDraft, ReviewQueue, SenderProfile, WriteDraftsResult } from '../../api/src/review/contract'
import { getJson, postJson } from './api'
import FitBadge from './FitBadge'
import type { Filter as CandidateFilter, Prospect } from './Prospects'
import { verdict } from './review/labels'
import { btnLink, btnPrimary, btnSecondary } from './ui'

interface DiscoveryRun {
  at: string
  added: number
  skipped: { handle: string; reason: string }[]
  spentMicros: number
  stoppedByBudget: boolean
  postsPending: number
}

interface Campaign extends CampaignLane {
  id: number
  name: string
  handles: string[]
  seeds: string[] | null
  queries: string[] | null
  lastDiscovery: DiscoveryRun | null
  budgetMicros: number
}

const money = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const SEGMENTS = [
  { key: 'strong', label: 'Strong', bar: 'bg-fit-strong' },
  { key: 'possible', label: 'Possible', bar: 'bg-fit-possible' },
  { key: 'weak', label: 'Weak', bar: 'bg-[#a9a9b2]' },
  { key: 'not_a_fit', label: 'Not a fit', bar: 'bg-fit-not' },
  { key: 'unscored', label: 'Not scored yet', bar: 'bg-raised ring-1 ring-inset ring-rule' },
] as const

export default function Overview({ campaignId, onReview, onProspects }: { campaignId: number; onReview: () => void; onProspects: (filter: CandidateFilter) => void }) {
  const qc = useQueryClient()
  const [waitingFor, setWaitingFor] = useState<{ at: string | null } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState<string | null>(null)

  const campaign = useQuery<Campaign>({
    queryKey: ['campaign', campaignId],
    queryFn: () => getJson(`/campaigns/${campaignId}`),
    refetchInterval: (q) => (waitingFor && (q.state.data?.lastDiscovery?.at ?? null) === waitingFor.at ? 5000 : false),
  })
  const waiting = !!waitingFor && (campaign.data?.lastDiscovery?.at ?? null) === waitingFor.at
  const prospects = useQuery<Prospect[]>({
    queryKey: ['prospects', campaignId],
    queryFn: () => getJson(`/campaigns/${campaignId}/prospects`),
    refetchInterval: waiting ? 5000 : false,
  })
  const queue = useQuery<ReviewQueue>({ queryKey: ['review-queue', campaignId], queryFn: () => getJson(`/review-queue?campaignId=${campaignId}`), retry: false })
  const readyQuery = useQuery<ReadyToDraft>({ queryKey: ['ready', campaignId], queryFn: () => getJson(`/campaigns/${campaignId}/drafts/ready`), retry: false })
  const estimate = useQuery<{ estimatedMicros: number }>({ queryKey: ['estimate', campaignId], queryFn: () => getJson(`/campaigns/${campaignId}/estimate`), retry: false })

  const search = useMutation({
    mutationFn: () => postJson<{ queued: boolean; reason?: string }>(`/campaigns/${campaignId}/discover`),
    onSuccess: (r) => {
      setNote(r.queued ? null : (r.reason ?? 'The search did not start.'))
      if (r.queued) setWaitingFor({ at: campaign.data?.lastDiscovery?.at ?? null })
    },
  })
  const write = useMutation({
    mutationFn: () => postJson<WriteDraftsResult>(`/campaigns/${campaignId}/drafts`, { limit: 10 }),
    onSuccess: (r) => {
      setDraftNote(
        r.drafted === 0
          ? 'Nobody is ready for a draft.'
          : `Wrote ${plural(r.drafted, 'draft')}.${r.readyToDraft ? ` ${plural(r.readyToDraft, 'more person', 'more people')} still waiting.` : ''}${r.noOpening ? ` ${plural(r.noOpening, 'person', 'people')} skipped: no reason to reach out yet.` : ''}`,
      )
      return Promise.all([qc.invalidateQueries({ queryKey: ['review-queue'] }), qc.invalidateQueries({ queryKey: ['ready'] })])
    },
  })
  const score = useMutation({
    mutationFn: () => postJson<{ queued: number }>(`/campaigns/${campaignId}/score`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prospects', campaignId] }),
  })

  if (campaign.isLoading) return <p role="status" className="text-sm text-muted">Loading…</p>
  if (campaign.error || !campaign.data) return <p role="alert" className="text-sm font-medium text-block">{campaign.error?.message ?? 'Campaign not found'}</p>

  const c = campaign.data
  const loadError = prospects.error ?? queue.error ?? readyQuery.error
  const people = prospects.data ?? []
  const counts = { strong: 0, possible: 0, weak: 0, not_a_fit: 0, unscored: 0 }
  for (const p of people) counts[p.fit ?? 'unscored'] += 1
  const drafts = (queue.data?.items ?? []).filter((i) => i.status === 'pending')
  const ready = readyQuery.data?.ready ?? 0
  const byVerdict = (t: string) => drafts.filter((d) => verdict(d).tone === t).length
  const run = c.lastDiscovery
  const sources = [c.handles.length && plural(c.handles.length, 'handle'), c.seeds?.length && plural(c.seeds.length, 'seed account'), c.queries?.length && plural(c.queries.length, 'search')].filter(Boolean).join(' · ')
  const top = people.filter((p) => p.fit === 'strong' || p.fit === 'possible').slice(0, 5)

  const writeButton =
    ready > 0 ? (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <button type="button" className={drafts.length > 0 ? 'rounded-lg bg-raised px-4 py-2 text-sm font-medium shadow-soft transition-colors hover:bg-paper disabled:text-muted' : btnPrimary} disabled={write.isPending} onClick={() => write.mutate()}>
          {write.isPending ? 'Writing…' : 'Write drafts (10)'}
        </button>
        <span className="text-xs text-muted">
          {drafts.length > 0 && `${plural(ready, 'person is', 'people are')} ready. `}Up to 10 at a time, so you can read each one. Strong first, then closer ties, then the newest posts.
        </span>
      </div>
    ) : null

  return (
    <div className="pb-16">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight">{c.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {sources || 'No sources yet'} · {run ? `last search ${ago(run.at)}` : 'no search yet'}
          </p>
          <LaneLine lane={c} />
        </div>
        <div>
          <button type="button" className={btnSecondary} disabled={search.isPending || waiting} onClick={() => search.mutate()}>
            {waiting ? 'Searching…' : run ? 'Search again' : 'Run first search'}
          </button>
          <p className="mt-1 text-xs text-muted">
            {estimate.data ? `About ${money(estimate.data.estimatedMicros)} · ` : ''}budget {money(c.budgetMicros)}
          </p>
        </div>
      </header>
      {loadError && <p role="alert" className="mt-3 text-sm font-medium text-block">Some numbers could not be loaded: {loadError.message}</p>}
      {waiting && <p className="mt-3 text-sm text-muted" role="status">The search is queued. This page updates when it finishes.</p>}
      {note && <p className="mt-3 text-sm font-medium text-warn" role="status">{note}</p>}
      {search.error && <p role="alert" className="mt-3 text-sm font-medium text-block">{search.error.message}</p>}

      <section aria-label="Next step" className="mt-8 flex flex-wrap items-center justify-between gap-x-10 gap-y-5 rounded-3xl bg-rail px-5 py-6 sm:px-10 sm:py-9">
        {drafts.length > 0 ? (
          <>
            <div>
              <h2 className="text-2xl font-bold leading-tight">
                <span className="text-accent">{drafts.length}</span> {drafts.length === 1 ? 'draft is' : 'drafts are'} waiting for your review
              </h2>
              <p className="mt-1.5 text-sm text-muted">
                {[byVerdict('ok') && `${byVerdict('ok')} ready`, byVerdict('warn') && `${byVerdict('warn')} to check`, byVerdict('stop') && `${byVerdict('stop')} to fix`].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <button type="button" className={btnPrimary} onClick={onReview}>
                Review drafts
              </button>
              {writeButton}
            </div>
          </>
        ) : counts.unscored > 0 ? (
          <>
            <div>
              <h2 className="text-2xl font-bold leading-tight">{plural(counts.unscored, 'person', 'people')} found, not scored yet</h2>
              <p className="mt-1.5 text-sm text-muted">Scoring reads their posts and decides how well they fit. Drafts are written for the good ones.</p>
            </div>
            <button type="button" className={btnPrimary} disabled={score.isPending} onClick={() => score.mutate()}>
              {score.isPending ? 'Queuing…' : 'Score them'}
            </button>
          </>
        ) : (
          <div>
            <h2 className="text-2xl font-bold leading-tight">
              {loadError ? 'The numbers did not load' : ready > 0 ? `${plural(ready, 'person is', 'people are')} ready for a draft` : people.length ? 'Nothing waiting for you' : 'No one found yet'}
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              {loadError
                ? 'Reload the page when the server is back.'
                : ready > 0
                ? 'Nothing is written by itself. Write drafts for several people at once, or pick one person in Candidates.'
                : people.length
                  ? 'Search again to find more people.'
                  : 'Run the first search to find people for this campaign.'}
            </p>
            {ready > 0 && (
              <button type="button" className={`${btnLink} mt-3`} onClick={() => onProspects('ready')}>
                View these {ready}
              </button>
            )}
          </div>
        )}
        {drafts.length === 0 && counts.unscored === 0 && ready > 0 && writeButton}
        {draftNote && (
          <p className="basis-full text-sm font-medium" role="status">
            {draftNote}
          </p>
        )}
        {write.error && (
          <p className="basis-full text-sm font-medium text-block" role="alert">
            {write.error.message}
          </p>
        )}
      </section>

      <section aria-label="What we found" className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">What we found</h2>
          <button type="button" className={btnLink} onClick={() => onProspects('all')}>
            View candidates
          </button>
        </div>
        {people.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nobody yet.</p>
        ) : (
          <>
            <p className="mt-4 text-4xl font-bold leading-none">
              {people.length} <span className="text-lg font-medium text-muted">{people.length === 1 ? 'person' : 'people'}</span>
            </p>
            <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-rail" role="img" aria-label="People by fit">
              {SEGMENTS.map((s) => counts[s.key] > 0 && <div key={s.key} className={s.bar} style={{ width: `${(counts[s.key] / people.length) * 100}%` }} />)}
            </div>
            <ul className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
              {SEGMENTS.map((s) => (
                <li key={s.key} className="flex items-center gap-2.5">
                  <span className={`size-3 rounded-full ${s.bar}`} />
                  <span className="text-xl font-bold leading-none">{counts[s.key]}</span>
                  <span className="text-sm text-muted">{s.label}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {top.length > 0 && (
        <section aria-label="Best matches" className="mt-12">
          <h2 className="text-lg font-bold">Best matches and why</h2>
          <ul className="mt-3">
            {top.map((p) => (
              <li key={p.id} className="border-b border-rule py-6">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <FitBadge fit={p.fit} />
                  <span className="min-w-0 text-base font-semibold wrap-anywhere">
                    {p.name} <span className="text-base font-normal text-muted">@{p.handle}</span>
                  </span>
                  {p.role && <span className="text-sm text-muted">{p.role}</span>}
                </div>
                <p className="mt-2 max-w-[70ch] text-sm">
                  {p.opening?.summary ?? <span className="text-muted">No reason to reach out yet</span>}
                  {p.opening && <span className="text-muted"> · {ago(p.opening.date)}{p.opening.freshness === 'stale' ? ' (stale)' : ''}</span>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Last search" className="mt-12">
        <h2 className="text-lg font-bold">Last search</h2>
        {!run ? (
          <p className="mt-3 text-sm text-muted">No search has run for this campaign yet.</p>
        ) : (
          <>
            <dl className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted">Finished</dt>
                <dd className="text-base font-semibold">{ago(run.at)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Result</dt>
                <dd className="text-base font-semibold">
                  {run.added} added, {run.skipped.length} skipped
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Spent</dt>
                <dd className="text-base font-semibold">
                  {money(run.spentMicros)} <span className="text-sm font-normal text-muted">of {money(c.budgetMicros)}</span>
                </dd>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rail">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, (run.spentMicros / c.budgetMicros) * 100)}%` }} />
                </div>
              </div>
            </dl>
            {run.stoppedByBudget && <p className="mt-4 text-sm font-medium text-warn">Stopped early because the budget was reached.</p>}
            {run.postsPending > 0 && <p className="mt-2 text-sm text-muted">{plural(run.postsPending, 'person', 'people')} still waiting for their posts to be read.</p>}
            {run.skipped.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium underline decoration-rule decoration-2 underline-offset-4">Why {run.skipped.length} were skipped</summary>
                <ul className="mt-2 space-y-1 text-muted">
                  {run.skipped.map((s) => (
                    <li key={s.handle}>
                      <span className="font-medium text-ink">@{s.handle}</span> · {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  )
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// The program this campaign offers and its call post.
function LaneLine({ lane: l }: { lane: CampaignLane }) {
  const profile = useQuery<SenderProfile>({ queryKey: ['sender-profile'], queryFn: () => getJson('/sender-profile'), retry: false })
  const program = profile.data?.programs.find((p) => p.id === l.programId)
  return (
    <p className="mt-1 text-sm text-muted">
      {program ? `Offers ${program.name}${program.deadline ? `, closes ${shortDay(program.deadline)}` : ''}` : 'No program chosen'}
      {l.callPostUrl && l.callPostedAt && (
        <>
          {' · '}
          <a className="underline underline-offset-4" href={l.callPostUrl} target="_blank" rel="noreferrer">
            Call post
          </a>{' '}
          of {shortDay(l.callPostedAt)}, keyword “{l.callKeyword}”
        </>
      )}
    </p>
  )
}
