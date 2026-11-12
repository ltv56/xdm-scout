import { useQuery } from '@tanstack/react-query'

interface Claim {
  side: 'for' | 'against' | 'unknown'
  text: string
  status: 'verified' | 'inferred'
  evidence: { id: string; url: string }[]
}

interface Prospect {
  id: number
  handle: string
  name: string
  bio: string
  followers: number
  seedCount: number
  fit: 'strong' | 'possible' | 'weak' | 'not_a_fit' | null
  role: string | null
  areas: string[]
  identityWarning: boolean
  opening: { type: string; summary: string | null; freshness: 'fresh' | 'stale' | 'expired'; url: string | null; date: string } | null
  claims: Claim[]
}

const FIT_LABEL = { strong: 'Strong', possible: 'Possible', weak: 'Weak', not_a_fit: 'Not a fit' }
const FIT_STYLE = {
  strong: 'bg-green-100 text-green-800',
  possible: 'bg-blue-100 text-blue-800',
  weak: 'bg-amber-100 text-amber-800',
  not_a_fit: 'bg-neutral-200 text-neutral-700',
}

export default function Prospects({ campaignId }: { campaignId: number }) {
  const { data, error, isLoading } = useQuery<Prospect[]>({
    queryKey: ['prospects', campaignId],
    queryFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/prospects`)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      return res.json()
    },
  })

  if (isLoading) return <p className="mt-6 text-sm text-neutral-600">Loading prospects...</p>
  if (error) return <p className="mt-6 text-sm text-red-700">{error.message}</p>
  if (!data?.length) return <p className="mt-6 text-sm text-neutral-600">No prospects in this campaign yet.</p>

  return (
    <ul className="mt-6 space-y-4">
      {data.map((p) => (
        <li key={p.id} className="rounded-lg border border-neutral-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <a className="font-medium hover:underline" href={`https://x.com/${p.handle}`} target="_blank" rel="noreferrer">
              {p.name} <span className="text-neutral-500">@{p.handle}</span>
            </a>
            {p.fit ? (
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${FIT_STYLE[p.fit]}`}>{FIT_LABEL[p.fit]}</span>
            ) : (
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">Not scored</span>
            )}
            {p.role && <span className="text-xs text-neutral-600">{p.role}</span>}
            {p.areas.map((a) => (
              <span key={a} className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                {a.replace('_', ' ')}
              </span>
            ))}
            <span className="ml-auto text-xs text-neutral-500">
              {p.seedCount > 0 && `followed by ${p.seedCount} seed${p.seedCount > 1 ? 's' : ''} · `}
              {p.followers.toLocaleString()} followers
            </span>
          </div>
          {p.identityWarning && <p className="mt-1 text-xs text-amber-700">Identity not confirmed</p>}
          <p className="mt-1 text-sm text-neutral-700">{p.bio}</p>

          {p.fit && (
            <p className="mt-2 text-sm">
              {p.opening && p.opening.freshness !== 'expired' ? (
                <>
                  <span className="font-medium">Opening ({p.opening.type}):</span> {p.opening.summary}{' '}
                  {p.opening.freshness === 'stale' && <span className="text-amber-700">Stale</span>}{' '}
                  {p.opening.url && (
                    <a className="text-blue-700 hover:underline" href={p.opening.url} target="_blank" rel="noreferrer">
                      source
                    </a>
                  )}
                </>
              ) : (
                <span className="text-neutral-600">No reason to reach out yet</span>
              )}
            </p>
          )}

          {p.claims.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {p.claims.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2">
                  <span className="w-14 shrink-0 text-xs uppercase text-neutral-500">{c.side}</span>
                  <span>{c.text}</span>
                  <span className={`rounded px-1.5 text-xs ${c.status === 'verified' ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-600'}`}>
                    {c.status === 'verified' ? 'Verified' : 'Inferred'}
                  </span>
                  {c.evidence.map((e) => (
                    <a key={e.id} className="text-xs text-blue-700 hover:underline" href={e.url} target="_blank" rel="noreferrer">
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
  )
}
