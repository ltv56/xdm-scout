import { useQuery } from '@tanstack/react-query'
import { getJson } from './api'
import FitBadge from './FitBadge'

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

export default function Prospects({ campaignId }: { campaignId: number }) {
  const { data, error, isLoading } = useQuery<Prospect[]>({
    queryKey: ['prospects', campaignId],
    queryFn: () => getJson(`/campaigns/${campaignId}/prospects`),
  })

  if (isLoading) return <p className="text-sm text-muted">Loading prospects…</p>
  if (error) return <p role="alert" className="text-sm font-medium text-block">{error.message}</p>
  if (!data?.length) return <p className="text-sm text-muted">No prospects in this campaign yet. Run a search from the Overview.</p>

  return (
    <div className="pb-16">
      <h1 className="text-[28px] font-bold leading-tight">Prospects</h1>
      <p className="mt-1 text-sm text-muted">{data.length} found, best fit first.</p>
      <ul className="mt-4">
        {data.map((p) => (
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
