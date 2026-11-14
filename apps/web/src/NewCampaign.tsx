import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SenderProfile } from '../../api/src/review/contract'
import { getJson, postJson } from './api'
import { btnPrimary, btnSecondary, field as baseField } from './ui'

const field = `${baseField} mt-1`

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)
const handles = (text: string) => lines(text).map((l) => l.replace(/^@/, ''))
const isPostLink = (s: string) => /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{10,20}([/?#].*)?$/.test(s.trim())

interface Props {
  first: boolean
  onCreated: (id: number) => void
  onCancel: () => void
}

export default function NewCampaign({ first, onCreated, onCancel }: Props) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [keywords, setKeywords] = useState('')
  const [handleText, setHandleText] = useState('')
  const [seeds, setSeeds] = useState('')
  const [queries, setQueries] = useState('')
  const [criteria, setCriteria] = useState('')
  const [budget, setBudget] = useState('')
  const [programId, setProgramId] = useState<number | null>(null)
  const [callUrl, setCallUrl] = useState('')
  const [callKeyword, setCallKeyword] = useState('')
  const [missing, setMissing] = useState<string | null>(null)

  const profile = useQuery<SenderProfile>({ queryKey: ['sender-profile'], queryFn: () => getJson('/sender-profile'), retry: false })
  const programs = profile.data?.programs ?? []
  const chosen = programId ?? programs[0]?.id ?? null

  const create = useMutation({
    mutationFn: async (campaign: unknown) => {
      const { id } = await postJson<{ id: number }>('/campaigns', campaign)
      await qc.invalidateQueries({ queryKey: ['campaigns'] })
      return id
    },
    onSuccess: (id) => onCreated(id),
  })

  const submit = () => {
    const budgetUsd = budget.trim() ? Number(budget) : undefined
    const gap = !name.trim()
      ? 'Give the campaign a name.'
      : !lines(keywords).length
        ? 'Add at least one keyword.'
        : !lines(handleText).length && !lines(seeds).length && !lines(queries).length
          ? 'Add at least one handle, seed account or search query.'
          : budgetUsd !== undefined && !(budgetUsd > 0 && budgetUsd <= 100)
            ? 'Budget must be above 0 and at most 100 USD.'
            : programs.length > 0 && chosen === null
              ? 'Pick the program this campaign offers.'
              : !!callUrl.trim() !== !!callKeyword.trim()
                ? 'Give both the call post and the keyword, or neither.'
                : callUrl.trim() && !isPostLink(callUrl)
                  ? 'The call post must be the link of a post on X, like https://x.com/yourfund/status/123…'
                  : null
    setMissing(gap)
    create.reset()
    if (gap) return
    create.mutate({
      name: name.trim(),
      keywords: lines(keywords),
      handles: handles(handleText),
      seeds: handles(seeds),
      queries: lines(queries),
      criteria: lines(criteria),
      ...(budgetUsd !== undefined && { budgetUsd }),
      programId: chosen,
      callPostUrl: callUrl.trim() || null,
      callKeyword: callKeyword.trim() || null,
    })
  }

  return (
    <form
      noValidate
      className="max-w-xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div>
        <h2 className="text-2xl font-bold">{first ? 'Start your first campaign' : 'New campaign'}</h2>
        <p className="mt-1 text-sm text-muted">
          {first ? 'A campaign is one search for people to message. Tell us who to look at, then run discovery from the Overview.' : 'Tell us who to look at, then run discovery from the Overview.'}
        </p>
      </div>

      <div>
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input id="name" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} className={field} />
      </div>

      <div>
        <label htmlFor="keywords" className="text-sm font-medium">
          Keywords
        </label>
        <textarea id="keywords" rows={3} value={keywords} onChange={(e) => setKeywords(e.target.value)} className={field} />
        <p className="mt-1 text-xs text-muted">One per line. Topics the people you want write about.</p>
      </div>

      <fieldset className="space-y-5">
        <legend className="text-sm font-medium">Where to find people (at least one)</legend>
        <div>
          <label htmlFor="handles" className="text-sm text-muted">
            Handles
          </label>
          <textarea id="handles" rows={3} value={handleText} onChange={(e) => setHandleText(e.target.value)} className={field} />
          <p className="mt-1 text-xs text-muted">One per line, with or without @.</p>
        </div>
        <div>
          <label htmlFor="seeds" className="text-sm text-muted">
            Seed accounts
          </label>
          <textarea id="seeds" rows={2} value={seeds} onChange={(e) => setSeeds(e.target.value)} className={field} />
          <p className="mt-1 text-xs text-muted">People they follow are added as prospects. Up to 10, one per line.</p>
        </div>
        <div>
          <label htmlFor="queries" className="text-sm text-muted">
            Search queries
          </label>
          <textarea id="queries" rows={2} value={queries} onChange={(e) => setQueries(e.target.value)} className={field} />
          <p className="mt-1 text-xs text-muted">Recent-post searches on X. Up to 10, one per line.</p>
        </div>
      </fieldset>

      <details>
        <summary className="cursor-pointer text-sm font-medium">Fund criteria (optional)</summary>
        <textarea
          aria-label="Fund criteria"
          placeholder={'Based in or building for Southeast Asia\nPre-Series A, no $100M+ fund yet'}
          rows={3}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          className={field}
        />
        <p className="mt-1 text-xs text-muted">One per line, up to 5. Each is checked against the person's posts and shown on their Fit card. Write each one so that met is good: “Pre-Series A, no $100M+ fund yet”, not “Has not raised a big round”.</p>
      </details>

      <div>
        <label htmlFor="program" className="text-sm font-medium">
          Program to offer
        </label>
        {programs.length > 0 ? (
          <select id="program" value={chosen ?? ''} onChange={(e) => setProgramId(Number(e.target.value))} className={field}>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.deadline ? `, applications close ${new Date(p.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-1 text-sm text-muted">{profile.isLoading ? 'Loading…' : 'Add a program in Account first. Drafts can only offer a program from your sender profile.'}</p>
        )}
        <p className="mt-1 text-xs text-muted">Every draft in this campaign offers this program, with its link and deadline.</p>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium">Call post (optional)</summary>
        <p className="mt-2 text-xs text-muted">
          Post it on X yourself, for example “Building agents in SEA? DM us ‘build’ for an Agentic AI Build Week invite.” xdm-scout does not post. People who DM you after it are added to this campaign, and you can reply to them from here.
        </p>
        <label htmlFor="call-url" className="mt-3 block text-sm text-muted">
          Link of the post
        </label>
        <input id="call-url" type="url" inputMode="url" value={callUrl} onChange={(e) => setCallUrl(e.target.value)} className={field} />
        <label htmlFor="call-keyword" className="mt-3 block text-sm text-muted">
          Keyword people DM
        </label>
        <input id="call-keyword" value={callKeyword} maxLength={40} onChange={(e) => setCallKeyword(e.target.value)} className={`${field} max-w-60`} />
        <p className="mt-1 text-xs text-muted">We read when the post went up from its link, so only DMs sent after it count.</p>
      </details>

      <div>
        <label htmlFor="budget" className="text-sm font-medium">
          Discovery budget in USD (optional)
        </label>
        <input id="budget" type="number" inputMode="decimal" min="0" max="100" step="any" value={budget} onChange={(e) => setBudget(e.target.value)} className={`${field} max-w-40`} />
        <p className="mt-1 text-xs text-muted">Discovery stops when X usage reaches this amount.</p>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={create.isPending} className={btnPrimary}>
          Create campaign
        </button>
        {!first && (
          <button type="button" onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
        )}
      </div>
      {missing && (
        <p role="alert" className="text-sm font-medium text-block">
          {missing}
        </p>
      )}
      {create.error && (
        <p role="alert" className="text-sm font-medium text-block">
          {create.error.message}
        </p>
      )}
    </form>
  )
}
