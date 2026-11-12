import { describe, expect, it } from 'vitest'
import { runChecks, StoredSentence } from './checks'

const profile = { intro: 'GenAI Fund backs early AI founders in Southeast Asia.', programs: [{ id: 1, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null }, { id: 2, name: 'Invite to our founder dinner', description: 'Invite to our founder dinner', link: 'https://genaifund.ai/', deadline: null }], signer: 'Vinh', sampleMessages: [] }
const now = new Date('2026-11-12T00:00:00Z')

const clean: StoredSentence[] = [
  { text: 'Saw you shipped v2 of your eval harness.', source: { type: 'evidence', evidenceId: 'post:1' } },
  { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: { type: 'sender_profile', field: 'intro' } },
  { text: 'Would an intro to investors be useful?', source: { type: 'sender_profile', field: 'program' } },
  { text: 'No worries if not.', source: { type: 'opt_out' } },
]

const run = (sentences: StoredSentence[], extra: Partial<Parameters<typeof runChecks>[0]> = {}) =>
  runChecks({ sentences, profile, openingDate: new Date('2026-11-08T00:00:00Z'), now, reviewerEdited: false, otherTexts: [], ...extra })

const codes = (r: ReturnType<typeof run>) => r.map((c) => `${c.level}:${c.code}`)

describe('draft checks', () => {
  it('passes a draft that is backed, offers something from the profile and lets them say no', () => {
    expect(run(clean)).toEqual([])
  })

  it('blocks a sentence with no source', () => {
    const r = run([...clean.slice(0, 1), { text: 'You built the best agent platform in Singapore.', source: null }, ...clean.slice(1)])
    expect(codes(r)).toContain('block:unbacked_claim')
    expect(r.find((c) => c.code === 'unbacked_claim')?.needsConfirm).toBe(false)
  })

  it('turns an unbacked sentence into a warn to confirm when the reviewer wrote it', () => {
    const r = run([...clean, { text: 'We met at the meetup.', source: null }], { reviewerEdited: true })
    expect(r.find((c) => c.code === 'unbacked_claim')).toMatchObject({ level: 'warn', needsConfirm: true })
  })

  it('blocks an offer that is not in the sender profile', () => {
    const r = run(clean.map((s) => (s.source?.type === 'sender_profile' && s.source.field === 'program' ? { ...s, text: 'Want a seed cheque of 500k?' } : s)))
    expect(codes(r)).toContain('block:offer_not_in_profile')
  })

  it('blocks a draft with no line that lets them say no', () => {
    expect(codes(run(clean.slice(0, 3)))).toContain('block:missing_opt_out')
  })

  it('blocks fake familiarity', () => {
    const r = run(clean.map((s, i) => (i === 0 ? { ...s, text: 'Big fan of your work.' } : s)))
    expect(codes(r)).toContain('block:fake_familiarity')
  })

  it('warns about a link, length, several questions and a near-identical queued draft', () => {
    const text = clean.map((s) => s.text).join(' ')
    expect(codes(run([clean[0], { ...clean[1], text: `${clean[1].text} See https://example.org.` }, ...clean.slice(2)]))).toContain('warn:has_link')
    expect(codes(run([{ ...clean[0], text: 'x'.repeat(460) }, ...clean.slice(1)]))).toContain('warn:too_long')
    expect(codes(run([...clean.slice(0, 2), { ...clean[2], text: 'Useful? Or not?' }, clean[3]]))).toContain('warn:many_questions')
    expect(codes(run(clean, { otherTexts: [text] }))).toContain('warn:similar_draft')
  })

  it('warns when the opening post is older than 30 days and names its date', () => {
    const r = run(clean, { openingDate: new Date('2026-10-05T00:00:00Z') })
    expect(r.find((c) => c.code === 'stale_opening')).toMatchObject({ level: 'warn' })
    expect(r.find((c) => c.code === 'stale_opening')?.message).toContain('5 Oct')
  })

  it('warns when the first sentence says nothing specific about them', () => {
    expect(codes(run([clean[1], clean[0], clean[2], clean[3]]))).toContain('warn:generic_first_line')
  })
})
