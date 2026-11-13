import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SenderProfile as Profile } from '../../api/src/review/contract'
import { Plus } from './icons'
import { getJson, putJson } from './api'
import { btnPrimary, btnSecondary, field as baseField } from './ui'

const field = `${baseField} mt-1`
// Grows with the text, so a long answer is never cut off behind the box.
const area = `${field} field-sizing-content`

export default function SenderProfile() {
  const { data, error, isLoading } = useQuery<Profile>({ queryKey: ['sender-profile'], queryFn: () => getJson('/sender-profile') })
  if (isLoading) return <p role="status" className="text-sm text-muted">Loading…</p>
  if (error || !data) return <p role="alert" className="text-sm font-medium text-block">{error?.message ?? 'No profile returned'}</p>
  return <ProfileForm profile={data} />
}

// A program as the form edits it: the deadline is '' while there is none.
type Draft = { id: number; name: string; description: string; link: string; deadline: string }
const MAX_PROGRAMS = 8
const isLink = (s: string) => /^https?:\/\/\S+$/.test(s)

function ProfileForm({ profile }: { profile: Profile }) {
  const qc = useQueryClient()
  const [intro, setIntro] = useState(profile.intro)
  const [programs, setPrograms] = useState<Draft[]>(profile.programs.map((p) => ({ ...p, deadline: p.deadline ?? '' })))
  const [signer, setSigner] = useState(profile.signer)
  const [samples, setSamples] = useState<string[]>([0, 1, 2].map((i) => profile.sampleMessages[i] ?? ''))

  const [missing, setMissing] = useState<string | null>(null)
  const change = (id: number, patch: Partial<Draft>) => setPrograms(programs.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const add = () => setPrograms([...programs, { id: Math.max(0, ...programs.map((p) => p.id)) + 1, name: '', description: '', link: '', deadline: '' }])

  const save = useMutation({
    mutationFn: () =>
      putJson<Profile>('/sender-profile', {
        intro: intro.trim(),
        programs: programs.map((p) => ({ id: p.id, name: p.name.trim(), description: p.description.trim(), link: p.link.trim(), deadline: p.deadline || null })),
        signer: signer.trim(),
        sampleMessages: samples.map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: (saved) => qc.setQueryData(['sender-profile'], saved),
  })

  const submit = () => {
    const gap = !intro.trim()
      ? 'Say who you are.'
      : !programs.length
        ? 'List at least one program you can offer.'
        : programs.some((p) => !p.name.trim() || !p.description.trim())
          ? 'Give every program a name and one sentence.'
          : programs.some((p) => !isLink(p.link.trim()))
            ? 'Give every program a link that starts with https://.'
            : !signer.trim()
          ? 'Say who signs the message.'
          : null
    setMissing(gap)
    if (!gap) save.mutate()
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
        <h3 className="text-xl font-bold">Sender profile</h3>
        <p className="mt-1 text-sm text-muted">Drafts may only claim what is written here or in the person's own posts.</p>
      </div>

      <div>
        <label htmlFor="intro" className="text-sm font-medium">
          Who you are
        </label>
        <textarea id="intro" rows={3} maxLength={400} value={intro} onChange={(e) => setIntro(e.target.value)} className={area} />
        <p className="mt-1 text-xs text-muted">{intro.length} of 400</p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Programs you can offer</legend>
        <p className="mt-1 text-xs text-muted">Each campaign offers one of these. A draft that offers anything else is blocked. Up to {MAX_PROGRAMS}.</p>
        <ul className="mt-3 space-y-3">
          {programs.map((p, n) => (
            <li key={p.id} className="rounded-2xl border border-rule p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Program {n + 1}</p>
                <button type="button" className="text-sm text-muted underline underline-offset-4 hover:text-ink" onClick={() => setPrograms(programs.filter((x) => x.id !== p.id))}>
                  Remove
                </button>
              </div>
              <label htmlFor={`p-name-${p.id}`} className="mt-3 block text-sm font-medium">
                Name
              </label>
              <input id={`p-name-${p.id}`} value={p.name} maxLength={80} onChange={(e) => change(p.id, { name: e.target.value })} className={field} />
              <label htmlFor={`p-desc-${p.id}`} className="mt-3 block text-sm font-medium">
                One sentence about it
              </label>
              <textarea id={`p-desc-${p.id}`} rows={2} maxLength={200} value={p.description} onChange={(e) => change(p.id, { description: e.target.value })} className={area} />
              <label htmlFor={`p-link-${p.id}`} className="mt-3 block text-sm font-medium">
                Link
              </label>
              <input id={`p-link-${p.id}`} type="url" inputMode="url" value={p.link} maxLength={300} onChange={(e) => change(p.id, { link: e.target.value })} className={field} />
              <label htmlFor={`p-deadline-${p.id}`} className="mt-3 block text-sm font-medium">
                Last day to apply (optional)
              </label>
              <input id={`p-deadline-${p.id}`} type="date" value={p.deadline} onChange={(e) => change(p.id, { deadline: e.target.value })} className={`${field} max-w-48`} />
            </li>
          ))}
        </ul>
        {programs.length < MAX_PROGRAMS && (
          <button type="button" className={`${btnSecondary} mt-3 inline-flex items-center gap-1.5`} onClick={add}>
            <Plus className="size-4" />
            Add a program
          </button>
        )}
      </fieldset>

      <div>
        <label htmlFor="signer" className="text-sm font-medium">
          Who signs the message
        </label>
        <input id="signer" value={signer} maxLength={64} onChange={(e) => setSigner(e.target.value)} className={field} />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Messages in your own voice (optional, up to 3)</legend>
        <p className="mt-1 text-xs text-muted">Drafts copy their tone, never their sentences.</p>
        {samples.map((s, i) => (
          <textarea
            key={i}
            aria-label={`Sample message ${i + 1}`}
            rows={2}
            maxLength={600}
            value={s}
            onChange={(e) => setSamples(samples.map((x, j) => (j === i ? e.target.value : x)))}
            className={area}
          />
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={save.isPending} className={btnPrimary}>
          Save profile
        </button>
        {save.isSuccess && <span className="text-sm text-muted">Saved.</span>}
      </div>
      {missing && (
        <p role="alert" className="text-sm font-medium text-block">
          {missing}
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-sm font-medium text-block">
          {save.error.message}
        </p>
      )}
    </form>
  )
}
