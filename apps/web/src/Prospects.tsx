import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReviewQueue } from '../../api/src/review/contract'
import { getJson, postJson } from './api'
import FitBadge from './FitBadge'
import { btnLink, btnSecondary } from './ui'

interface Claim {
  side: 'for' | 'against' | 'unknown'
  text: string
  status: 'verified' | 'inferred'
  evidence: { id: string; url: string }[]
}

export interface Prospect {
  id: number
  handle: string
  name: string
  bio: string
  followers: number
  seedCount: number
  lastPostAt: string | null
  criteria: { text: string; status: 'met' | 'not_met' | 'unknown'; evidenceIds: string[] }[]
  fit: 'strong' | 'possible' | 'weak' | 'not_a_fit' | null
  relationship: 'messaged_us' | 'follower' | 'engaged' | 'adjacent' | 'cold'
  status: 'new' | 'shortlisted' | 'dismissed'
  role: string | null
  areas: string[]
  identityWarning: boolean
  opening: { type: string; summary: string | null; freshness: 'fresh' | 'stale' | 'expired'; url: string | null; date: string } | null
  claims: Claim[]
}

const CRITERION_LABEL = { met: 'met', not_met: 'not met', unknown: 'unknown' }
const CRITERION_STYLE = {
  met: 'bg-ok-bg text-ok font-semibold',
  not_met: 'bg-block-bg text-block',
  unknown: 'bg-rail text-muted',
}

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'today' : `${days}d ago`
}

// "Draft a message": one person, on request. It writes the draft and puts it in Review. Anyone but Not a fit, and only with an opening.
function DraftControl({ p, campaignId, inReview, onReview }: { p: Prospect; campaignId: number; inReview: boolean; onReview: () => void }) {
  const qc = useQueryClient()
  const make = useMutation({
    mutationFn: () =>
      postJson(`/campaigns/${campaignId}/prospects/${p.id}/draft`),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['review-queue'] }), qc.invalidateQueries({ queryKey: ['ready'] })]),
  })
  const why = p.fit === null ? 'Not scored yet' : p.fit === 'not_a_fit' ? 'Not a fit' : !p.opening || p.opening.freshness === 'expired' ? 'No reason to reach out yet' : null

  if (inReview || make.isSuccess) {
    return (
      <p className="mt-3 flex items-center gap-3 text-sm">
        <span className="font-semibold">Draft written</span>
        <button type="button" className={btnLink} onClick={onReview}>
          Open in Review
        </button>
      </p>
    )
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" className={btnSecondary} disabled={!!why || make.isPending} title={why ?? undefined} onClick={() => make.mutate()}>
        {make.isPending ? 'Writing…' : 'Draft a message'}
      </button>
      {why && <span className="text-sm text-muted">{why}</span>}
      {make.error && (
        <span role="alert" className="text-sm font-medium text-block">
          {make.error.message}
        </span>
      )}
    </div>
  )
}

export type Filter = 'all' | 'ready' | 'drafted' | 'not_a_fit'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready for a draft' },
  { id: 'drafted', label: 'Drafted' },
  { id: 'not_a_fit', label: 'Not a fit' },
]

export default function Prospects({ campaignId, onReview, initialFilter = 'all' }: { campaignId: number; onReview: () => void; initialFilter?: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const { data, error, isLoading } = useQuery<Prospect[]>({
    queryKey: ['prospects', campaignId],
    queryFn: () => getJson(`/campaigns/${campaignId}/prospects`),
  })
  const queue = useQuery<ReviewQueue>({ queryKey: ['review-queue', campaignId], queryFn: () => getJson(`/review-queue?campaignId=${campaignId}`), retry: false })
  const inReview = new Set((queue.data?.items ?? []).map((i) => i.prospect.handle))

  if (isLoading) return <p className="text-sm text-muted">Loading candidates…</p>
  if (error) return <p role="alert" className="text-sm font-medium text-block">{error.message}</p>
  if (!data?.length) return <p className="text-sm text-muted">No candidates in this campaign yet. Run a search from the Overview.</p>

  // Ready: could get a draft now. Same rule as the Overview and the Write drafts button.
  const isReady = (p: Prospect) => (p.fit === 'strong' || p.fit === 'possible') && !!p.opening && p.opening.freshness !== 'expired' && !inReview.has(p.handle)
  const matches: Record<Filter, (p: Prospect) => boolean> = {
    all: () => true,
    ready: isReady,
    drafted: (p) => inReview.has(p.handle),
    not_a_fit: (p) => p.fit === 'not_a_fit',
  }
  const shown = data.filter(matches[filter])

  return (
    <div className="pb-16">
      <h1 className="text-[28px] font-bold leading-tight">Candidates</h1>
      <p className="mt-1 text-sm text-muted">The people this campaign found, best fit first. Review holds only the ones with a draft.</p>
      <div role="tablist" aria-label="Show" className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${filter === f.id ? 'bg-ink text-white' : 'bg-rail hover:bg-rule'}`}
          >
            {f.label} <span className={filter === f.id ? 'text-white/70' : 'text-muted'}>{data.filter(matches[f.id]).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="mt-6 text-sm text-muted">Nobody in this list.</p>}
      <ul className="mt-4">
        {shown.map((p) => (
          <li key={p.id} className="border-b border-rule py-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <FitBadge fit={p.fit} />
              <a className="min-w-0 text-lg font-semibold wrap-anywhere hover:underline" href={`https://x.com/${p.handle}`} target="_blank" rel="noreferrer">
                {p.name} <span className="font-normal text-muted">@{p.handle}</span>
              </a>
              {(p.role || p.areas.length > 0) && <span className="text-sm text-muted">{[p.role, ...p.areas.map((a) => a.replace('_', ' '))].filter(Boolean).join(' · ')}</span>}
              <span className="ml-auto text-sm text-muted">
                {p.seedCount > 0 && `followed by ${p.seedCount} seed${p.seedCount > 1 ? 's' : ''} · `}
                {p.followers.toLocaleString()} followers
                {p.lastPostAt && ` · last post ${daysAgo(p.lastPostAt)}`}
              </span>
            </div>
            {p.identityWarning && <p className="mt-1 text-sm font-medium text-warn">Identity not confirmed</p>}
            <p className="mt-2 max-w-[80ch] text-[15px]">{p.bio}</p>

            {p.fit && (
              <p className="mt-3 text-[15px]">
                {p.opening && p.opening.freshness !== 'expired' ? (
                  <>
                    <span className="font-semibold">Opening ({p.opening.type}):</span> {p.opening.summary}{' '}
                    {p.opening.freshness === 'stale' && <span className="font-medium text-warn">Stale</span>}{' '}
                    {p.opening.url && (
                      <a className="underline underline-offset-4" href={p.opening.url} target="_blank" rel="noreferrer">
                        source
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-muted">No reason to reach out yet</span>
                )}
              </p>
            )}

            <DraftControl p={p} campaignId={campaignId} inReview={inReview.has(p.handle)} onReview={onReview} />

            {p.criteria.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                {p.criteria.map((c) => (
                  <li key={c.text} className={`rounded-full px-2.5 py-1 ${CRITERION_STYLE[c.status]}`}>
                    {c.text}: {CRITERION_LABEL[c.status]}
                  </li>
                ))}
              </ul>
            )}

            {p.claims.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {p.claims.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2">
                    <span className="w-20 shrink-0 text-xs uppercase text-muted">{c.side}</span>
                    <span>{c.text}</span>
                    <span className={`rounded-full px-2 text-xs ${c.status === 'verified' ? 'bg-ok-bg font-semibold text-ok' : 'bg-rail text-muted'}`}>
                      {c.status === 'verified' ? 'Backed by a post' : 'Our guess'}
                    </span>
                    {c.evidence.map((e) => (
                      <a key={e.id} className="text-xs underline underline-offset-4" href={e.url} target="_blank" rel="noreferrer">
                        {e.id.startsWith('bio:') ? 'bio' : 'post'}
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
