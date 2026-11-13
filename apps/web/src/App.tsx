import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { CampaignSummary, ReviewQueue as Queue, SenderProfile as Profile } from '../../api/src/review/contract'
import { getJson } from './api'
import Account from './Account'
import CampaignPicker from './CampaignPicker'
import { User as UserIcon } from './icons'
import NewCampaign from './NewCampaign'
import Overview from './Overview'
import Prospects, { type Filter as CandidateFilter } from './Prospects'
import ReviewQueue from './review/ReviewQueue'

interface Health {
  status: string
  db: string
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'review', label: 'Review' },
  { id: 'prospects', label: 'Candidates' },
  { id: 'profile', label: 'Account' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('all')
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
  const profile = useQuery<Profile>({ queryKey: ['sender-profile'], queryFn: () => getJson('/sender-profile'), retry: false })
  const initials = (profile.data?.signer ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

  const scroll = 'h-full overflow-y-auto px-5 py-8 sm:px-12 sm:py-10'

  return (
    <div className="min-h-screen lg:flex lg:h-screen lg:flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-raised focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-pop">
        Skip to content
      </a>
      <header className="mx-auto flex w-full max-w-[1280px] shrink-0 flex-wrap items-center gap-x-10 gap-y-2 px-6 py-5 text-sm">
        <span className="text-base font-bold tracking-tight text-ink">xdm-scout</span>
        <nav aria-label="Sections" className="flex flex-wrap gap-x-6">
          {TABS.filter((t) => t.id !== 'profile').map((t) => (
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
          <CampaignPicker
            list={list}
            active={active}
            onSelect={(id) => {
              setCampaignId(id)
              setCreating(false)
              if (tab === 'profile') setTab('overview')
            }}
            onNew={() => {
              if (tab === 'profile') setTab('overview')
              setCreating(true)
            }}
          />
          <div className="flex items-center gap-4">
            {(health.error || (health.data && health.data.status !== 'ok')) && <span className="text-xs font-medium text-block">API unreachable</span>}
            <button
              type="button"
              aria-label="Account"
              title="Account"
              onClick={() => {
                setTab('profile')
                setCreating(false)
              }}
              aria-current={tab === 'profile' ? 'page' : undefined}
              className={`flex size-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink transition-shadow hover:bg-accent-hover ${tab === 'profile' ? 'ring-2 ring-accent ring-offset-2 ring-offset-paper' : ''}`}
            >
              {initials || <UserIcon className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1280px] px-6 pb-6 lg:min-h-0 lg:flex-1">
        <div className="overflow-hidden rounded-3xl bg-raised shadow-soft lg:h-full lg:min-h-[460px]">
          {tab === 'profile' ? (
            <div className={scroll}>
              <Account />
            </div>
          ) : creating || active === null ? (
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
              <Overview campaignId={active} onReview={() => setTab('review')} onProspects={(f) => {
                  setCandidateFilter(f)
                  setTab('prospects')
                }}
              />
            </div>
          ) : tab === 'review' ? (
            <ReviewQueue campaignId={active} />
          ) : (
            <div className={scroll}>
              <Prospects key={candidateFilter} campaignId={active} onReview={() => setTab('review')} initialFilter={candidateFilter} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
