import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { CampaignSummary, ReviewQueue as Queue } from '../../api/src/review/contract'
import { getJson } from './api'
import NewCampaign from './NewCampaign'
import Overview from './Overview'
import Prospects from './Prospects'
import ReviewQueue from './review/ReviewQueue'
import { btnSecondary } from './ui'

interface Health {
  status: string
  db: string
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'review', label: 'Review' },
  { id: 'prospects', label: 'Prospects' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [campaignId, setCampaignId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const health = useQuery<Health>({ queryKey: ['health'], queryFn: () => getJson('/health') })
  const campaigns = useQuery<CampaignSummary[]>({ queryKey: ['campaigns'], queryFn: () => getJson('/campaigns') })

  const list = campaigns.data ?? []
  const active = campaignId ?? list[0]?.id ?? null
  const queue = useQuery<Queue>({
    queryKey: ['review-queue', active],
    queryFn: () => getJson(`/review-queue?campaignId=${active}`),
    enabled: active !== null,
    retry: false,
  })
  const waiting = (queue.data?.items ?? []).filter((i) => i.status === 'pending').length

  const scroll = 'h-full overflow-y-auto px-12 py-10'

  return (
    <div className="min-h-screen lg:flex lg:h-screen lg:flex-col">
      <header className="mx-auto flex w-full max-w-[1280px] shrink-0 flex-wrap items-center gap-x-10 gap-y-2 px-6 py-5 text-sm">
        <span className="text-base font-bold tracking-tight text-ink">xdm-scout</span>
        <nav aria-label="Sections" className="flex flex-wrap gap-x-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
                setCreating(false)
              }}
              aria-current={tab === t.id && !creating ? 'page' : undefined}
              className={`relative py-1 transition-colors ${tab === t.id && !creating ? "font-semibold text-ink after:absolute after:inset-x-0 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-accent" : 'text-muted hover:text-ink'}`}
            >
              {t.label}
              {t.id === 'review' && waiting > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-ink">{waiting}</span>}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:ml-auto">
          {list.length > 0 && (
            <label className="flex items-center gap-2 rounded-xl bg-raised px-3.5 py-2 shadow-soft">
              <span className="text-muted">Campaign</span>
              <select
                aria-label="Campaign"
                value={active ?? ''}
                onChange={(e) => {
                  setCampaignId(Number(e.target.value))
                  setCreating(false)
                }}
                className="bg-transparent font-semibold"
              >
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className={btnSecondary} onClick={() => setCreating(true)}>
            New campaign
          </button>
          {(health.error || (health.data && health.data.status !== 'ok')) && <span className="text-xs font-medium text-block">API unreachable</span>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-6 pb-6 lg:min-h-0 lg:flex-1">
        <div className="overflow-hidden rounded-3xl bg-raised shadow-soft lg:h-full lg:min-h-[460px]">
          {creating || active === null ? (
            <div className={scroll}>
              <NewCampaign
                first={active === null}
                onCancel={() => setCreating(false)}
                onCreated={(id) => {
                  setCampaignId(id)
                  setCreating(false)
                  setTab('overview')
                }}
              />
            </div>
          ) : tab === 'overview' ? (
            <div className={scroll}>
              <Overview campaignId={active} onReview={() => setTab('review')} onProspects={() => setTab('prospects')} />
            </div>
          ) : tab === 'review' ? (
            <ReviewQueue campaignId={active} />
          ) : (
            <div className={scroll}>
              <Prospects campaignId={active} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
