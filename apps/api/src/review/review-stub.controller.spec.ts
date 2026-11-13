import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { approveResult, reviewItem, reviewQueue, senderProfile } from './contract'
import { hashContent } from '../sending/sending.service'
import { ReviewStubController } from './review-stub.controller'

let c: ReviewStubController

beforeEach(() => {
  c = new ReviewStubController()
})

const item = (draftId: number) => c.queue('1').items.find((i) => i.draftId === draftId)!

describe('review stub', () => {
  it('returns a queue that matches the contract and covers the screen states', () => {
    const q = reviewQueue.parse(c.queue('1'))
    const items = q.items
    expect(items.some((i) => i.checks.length === 0)).toBe(true)
    expect(items.some((i) => i.checks.some((k) => k.level === 'block'))).toBe(true)
    expect(items.some((i) => i.checks.some((k) => k.level === 'warn'))).toBe(true)
    expect(items.some((i) => i.kind === 'reply' && i.sendPath === 'API_SEND')).toBe(true)
    // Every draft can also be sent by hand: a reply the app could send still gets a compose link.
    expect(items.every((i) => i.openInXUrl?.startsWith('https://x.com/messages/compose?recipient_id='))).toBe(true)
    expect(items.some((i) => i.sendPath === 'HUMAN_HANDOFF' && i.openInXUrl?.startsWith('https://x.com/messages/compose?recipient_id='))).toBe(true)
    expect(items.some((i) => i.checks.some((k) => k.needsConfirm))).toBe(true)
    expect(items.some((i) => i.sentences.some((s) => s.source === null))).toBe(true)
  })

  it('carries a dated metrics snapshot, criteria and decision probabilities for every draft', () => {
    const items = reviewQueue.parse(c.queue('1')).items
    for (const i of items) {
      expect(i.prospect.snapshot.sampleSize).toBeGreaterThan(0)
      expect(i.prospect.snapshot.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(i.decisions.map((d) => d.code)).toEqual(expect.arrayContaining(['no_sensitive', 'no_familiarity', 'one_person', 'claim_backed', 'own_account']))
      for (const d of i.decisions) expect(d.probability).toBeGreaterThanOrEqual(0)
    }
    expect(items.filter((i) => i.kind === 'reply').every((i) => i.decisions.some((d) => d.code === 'invitation'))).toBe(true)
    expect(items.some((i) => i.prospect.criteria.some((k) => k.status === 'unknown'))).toBe(true)
    expect(() => reviewItem.parse({ ...items[0], decisions: [{ code: 'claim_backed', question: 'q', probability: 1.4, model: 'fixture', input: 'x', band: 'high' }] })).toThrow()
  })

  it('has one fully loaded draft to check how long the review layout gets', () => {
    const full = item(107)
    expect(reviewItem.parse(full).draftId).toBe(107)
    expect(full.prospect.name!.length).toBeGreaterThan(20)
    expect(full.prospect.criteria).toHaveLength(5)
    expect(full.evidence.length).toBeGreaterThanOrEqual(5)
    expect(new Set(full.evidence.map((e) => e.kind))).toEqual(new Set(['post', 'bio']))
    expect(full.sentences.length).toBeGreaterThanOrEqual(6)
    expect(full.text.length).toBeGreaterThan(380)
    expect(full.checks.some((k) => k.level === 'warn')).toBe(true)
    expect(full.prospect.snapshot.engagementMedian).not.toBeNull()
  })

  it('gives every person a bio and a short history with us, so the page can show both', () => {
    const items = reviewQueue.parse(c.queue('1')).items
    for (const i of items) {
      expect(i.prospect).toHaveProperty('bio')
      expect(i.prospect).toHaveProperty('history')
    }
    expect(items.some((i) => i.prospect.bio === null)).toBe(true)
    expect(items.filter((i) => i.prospect.bio !== null).every((i) => i.prospect.bio!.length > 10)).toBe(true)
    const known = items.filter((i) => ['messaged_us', 'engaged', 'follower'].includes(i.prospect.relationship))
    expect(known.length).toBeGreaterThan(2)
    expect(known.every((i) => /\d{1,2} [A-Z][a-z]{2}/.test(i.prospect.history ?? ''))).toBe(true)
    expect(items.filter((i) => ['cold', 'adjacent'].includes(i.prospect.relationship)).every((i) => i.prospect.history === null)).toBe(true)
  })

  it('opens first messages with a greeting made by the app, in more than one wording', () => {
    const items = reviewQueue.parse(c.queue('1')).items
    const first = items.filter((i) => i.kind === 'first_message')
    const openers = first.map((i) => i.sentences[0])
    expect(openers.every((o) => o.source?.type === 'greeting')).toBe(true)
    expect(openers.every((o) => /^(Hi|Hello|Hey)/.test(o.text))).toBe(true)
    expect(new Set(openers.map((o) => o.text.split(' ')[0])).size).toBeGreaterThanOrEqual(3)
    expect(items.filter((i) => i.kind === 'reply').every((i) => i.sentences[0].source?.type !== 'greeting')).toBe(true)
    // a person with no display name still gets a greeting, without a name
    expect(items.find((i) => i.prospect.name === null)!.sentences[0].text).toMatch(/^(Hi|Hello|Hey)( there)?!$/)
  })

  it('says what each model answer was given and which band its number falls in', () => {
    const items = reviewQueue.parse(c.queue('1')).items
    for (const i of items) {
      for (const d of i.decisions) {
        expect(d.input.length).toBeGreaterThan(20)
        expect(d.band).toBe(d.probability >= 0.7 ? 'high' : d.probability <= 0.3 ? 'low' : 'middle')
      }
    }
    expect(new Set(items.flatMap((i) => i.decisions.map((d) => d.band)))).toEqual(new Set(['high', 'middle', 'low']))
    expect(items.filter((i) => i.kind === 'first_message').every((i) => i.decisions.length >= 5)).toBe(true)
    // the answers follow the checks: a "big fan" draft is unlikely to avoid pretending to know them
    const fan = items.find((i) => /big fan/i.test(i.text))!
    expect(fan.decisions.find((d) => d.code === 'no_familiarity')!.band).toBe('low')
  })

  it('says the sample answers come from fixtures, and keeps the question labels from the spec', () => {
    const decisions = reviewQueue.parse(c.queue('1')).items.flatMap((i) => i.decisions)
    // Nothing is measured or answered by a real model yet, so every sample answer says it is a fixture.
    for (const d of decisions) expect(d.answeredBy).toBe('fixture')
    expect(decisions.every((d) => !('model' in d))).toBe(true)
    expect(new Set(decisions.map((d) => d.question))).toEqual(
      new Set(['Asked us to get in touch', 'No sensitive guesses', 'No made-up familiarity', 'Written for this person', 'No loaded questions', 'Backed by the evidence', 'Looks like their own account']),
    )
  })

  it('checks the claims one sentence at a time, and leaves the other questions without a sentence', () => {
    for (const i of reviewQueue.parse(c.queue('1')).items) {
      const claims = i.decisions.filter((d) => d.code === 'claim_backed')
      const backed = i.sentences.map((s, n) => ({ s, n })).filter(({ s }) => s.source === null || s.source.type === 'evidence')
      expect(claims.map((d) => d.sentence)).toEqual(backed.map(({ n }) => n))
      for (const d of i.decisions.filter((d) => d.code !== 'claim_backed')) expect(d.sentence).toBeNull()
      for (const d of claims) expect(d.input).toContain(i.sentences[d.sentence!].text)
    }
    const unbacked = c.queue('1').items.find((i) => i.sentences.some((s) => s.source === null))!
    const bad = unbacked.decisions.filter((d) => d.code === 'claim_backed' && unbacked.sentences[d.sentence!].source === null)
    expect(bad.length).toBeGreaterThan(0)
    expect(bad.every((d) => d.band === 'low')).toBe(true)
  })

  it('attaches a measurement to the policy questions only, and says when it is sample data', () => {
    const decisions = reviewQueue.parse(c.queue('1')).items.flatMap((i) => i.decisions)
    for (const d of decisions.filter((d) => ['claim_backed', 'own_account'].includes(d.code))) expect(d.calibration).toBeNull()
    const measured = decisions.filter((d) => d.calibration)
    expect(measured.length).toBeGreaterThan(0)
    expect(decisions.some((d) => ['invitation', 'no_sensitive', 'no_familiarity', 'one_person'].includes(d.code) && d.calibration === null)).toBe(true)
    for (const d of measured) {
      const m = d.calibration!
      expect(m.sample).toBe(true)
      expect(m.right).toBeLessThanOrEqual(m.examples)
      expect(m.low).toBeLessThan(m.right / m.examples)
      expect(m.high).toBeGreaterThan(m.right / m.examples)
      expect(m.high).toBeLessThanOrEqual(1)
      expect(m.model).toMatch(/^jev-/)
      expect(m.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('backs every met or not met criterion with the posts it rests on, and leaves unknown with none', () => {
    const criteria = reviewQueue.parse(c.queue('1')).items.flatMap((i) => i.prospect.criteria)
    expect(criteria.some((k) => k.status === 'unknown')).toBe(true)
    expect(criteria.some((k) => k.status === 'not_met')).toBe(true)
    for (const k of criteria) {
      if (k.status === 'unknown') expect(k.evidence).toHaveLength(0)
      else expect(k.evidence.length).toBeGreaterThan(0)
    }
  })

  it('writes every criterion so that met is good, and shows a number or date only where the evidence holds one', () => {
    const items = reviewQueue.parse(c.queue('1')).items
    const criteria = items.flatMap((i) => i.prospect.criteria)
    expect(criteria.every((k) => !/^(has not|not |no |without )/i.test(k.text))).toBe(true)
    expect(criteria.some((k) => k.text === 'Pre-Series A, no $100M+ fund yet' && k.status === 'not_met')).toBe(true)
    for (const k of criteria) {
      if (k.status === 'unknown') expect(k.fact).toBeNull()
      if (k.fact !== null) expect(k.fact).toMatch(/\d/)
    }
    expect(criteria.some((k) => k.status === 'met' && k.fact === null)).toBe(true)
    expect(criteria.some((k) => k.fact !== null && /\d+ days? ago/.test(k.fact))).toBe(true)
    // a number from a bio is one the bio really states
    const team = item(107).prospect.criteria.find((k) => /team/i.test(k.text))!
    expect(team.evidence[0].kind).toBe('bio')
    expect(team.fact).toBe('Team of 12, in bio')
    expect(team.evidence[0].text).toContain('Team of 12')
  })

  it("knows each person's main language and each draft's language, with an English copy beside a translated draft", () => {
    const items = reviewQueue.parse(c.queue('1')).items
    for (const i of items) {
      expect(['en', 'vi', 'th', 'id', null]).toContain(i.prospect.mainLanguage)
      expect(i.language).toBe('en')
      expect(i.englishText).toBeNull()
    }
    expect(items.some((i) => i.prospect.mainLanguage === 'vi')).toBe(true)
    expect(items.some((i) => i.prospect.mainLanguage === null)).toBe(true)
  })

  it("drafts again in the person's language: same sources, English kept beside, approval hash follows the text that will be sent", () => {
    const before = item(101)
    const vi = reviewItem.parse(c.language(101, { language: 'vi' }))
    expect(vi.language).toBe('vi')
    expect(vi.englishText).toBe(before.text)
    expect(vi.text).not.toBe(before.text)
    expect(vi.sentences.map((s) => s.source)).toEqual(before.sentences.map((s) => s.source))
    expect(vi.contentHash).toBe(hashContent(vi.text))
    expect(vi.openInXUrl).toContain(encodeURIComponent(vi.text))
    expect(vi.checks.some((k) => k.level === 'block')).toBe(false)
    expect(vi.status).toBe('pending')
    const back = reviewItem.parse(c.language(101, { language: 'en' }))
    expect(back.text).toBe(before.text)
    expect(back.englishText).toBeNull()
    expect(back.contentHash).toBe(before.contentHash)
  })

  it('refuses a language it has no draft for, and a draft the reviewer has edited', () => {
    expect(() => c.language(102, { language: 'vi' })).toThrow(ConflictException)
    expect(() => c.language(101, { language: 'fr' })).toThrow(BadRequestException)
    c.edit(101, { text: 'Hi Mai Tran! Saw your eval harness. No worries if not.' })
    expect(() => c.language(101, { language: 'vi' })).toThrow(ConflictException)
  })

  it('lists programs in the sender profile, each with a name, description, link and an optional deadline', () => {
    const p = senderProfile.parse(c.profile())
    expect(p.programs.length).toBeGreaterThanOrEqual(3)
    expect(p.programs.some((x) => x.deadline !== null)).toBe(true)
    expect(p.programs.some((x) => x.deadline === null)).toBe(true)
    expect(new Set(p.programs.map((x) => x.id)).size).toBe(p.programs.length)
    expect(() => c.saveProfile({ ...p, programs: [] })).toThrow(BadRequestException)
    expect(() => c.saveProfile({ ...p, programs: [{ id: 1, name: 'x', description: 'y', link: 'not a link', deadline: null }] })).toThrow(BadRequestException)
  })

  it('keeps the program and the call post of a campaign, and reads the posting time off the post id', () => {
    const programId = senderProfile.parse(c.profile()).programs[0].id
    expect(c.lane(1)).toEqual({ programId, callPostUrl: null, callKeyword: null, callPostedAt: null })
    // a post id carries its time: milliseconds since X's epoch in the high bits
    const id = BigInt(Date.parse('2026-11-01T03:00:00Z') - 1288834974657) << 22n
    const saved = c.saveLane(1, { programId, callPostUrl: `https://x.com/genaifund_ai/status/${id}`, callKeyword: 'build' })
    expect(saved.callPostedAt).toBe('2026-11-01T03:00:00.000Z')
    expect(c.lane(1)).toEqual(saved)
    const off = c.saveLane(1, { programId, callPostUrl: null, callKeyword: null })
    expect(off.callPostedAt).toBeNull()
  })

  it('rejects a half-filled or wrong call post, and a program that is not in the profile', () => {
    const programId = senderProfile.parse(c.profile()).programs[0].id
    const url = 'https://x.com/genaifund_ai/status/1990000000000000000'
    expect(() => c.saveLane(1, { programId, callPostUrl: url, callKeyword: null })).toThrow(BadRequestException)
    expect(() => c.saveLane(1, { programId, callPostUrl: null, callKeyword: 'build' })).toThrow(BadRequestException)
    expect(() => c.saveLane(1, { programId, callPostUrl: 'https://example.com/post/1', callKeyword: 'build' })).toThrow(BadRequestException)
    expect(() => c.saveLane(1, { programId: 9999, callPostUrl: null, callKeyword: null })).toThrow(BadRequestException)
    expect(() => c.saveLane(0, { programId, callPostUrl: null, callKeyword: null })).toThrow(BadRequestException)
  })

  it('lays a first message out like a DM: greeting on its own line, the opt-out on its own line, in every language', () => {
    for (const i of reviewQueue.parse(c.queue('1')).items.filter((x) => x.kind === 'first_message')) {
      const lines = i.text.split('\n')
      expect(lines[0]).toBe(i.sentences[0].text)
      expect(lines.at(-1)).toBe(i.sentences.at(-1)!.text)
      expect(lines).toHaveLength(3)
    }
    const vi = c.language(101, { language: 'vi' })
    expect(vi.text.split('\n')).toHaveLength(3)
    expect(vi.englishText!.split('\n')).toHaveLength(3)
    // a reply has no greeting: only the opt-out line is set apart
    expect(item(103).text.split('\n')).toHaveLength(2)
  })

  it('keeps the line breaks the reviewer typed, and hashes exactly that text', () => {
    const typed = 'Hi Mai Tran!\n\nSaw your eval harness for Vietnamese LLMs.\nNo worries if not.'
    const edited = reviewItem.parse(c.edit(101, { text: typed }))
    expect(edited.text).toBe(typed)
    expect(edited.contentHash).toBe(hashContent(typed))
    expect(edited.sentences.map((x) => x.text)).toEqual(['Hi Mai Tran!', 'Saw your eval harness for Vietnamese LLMs.', 'No worries if not.'])
    expect(edited.openInXUrl).toContain(encodeURIComponent(typed))
  })

  it('says how many people are ready to be drafted for, without drafting anyone by itself', async () => {
    expect(c.queue('1').items).toHaveLength(7)
    expect((await c.readyToDraft(1)).ready).toBeGreaterThan(10)
    expect(c.queue('1').items).toHaveLength(7)
  })

  it('writes up to ten drafts at once: Strong first, then the warmer relationship, then the newer opening', async () => {
    const before = (await c.readyToDraft(1)).ready
    const result = await c.writeDrafts(1, {})
    expect(result.drafted).toBe(10)
    expect(result.readyToDraft).toBe(before - 10)
    expect(result.noOpening).toBeGreaterThan(0)
    const items = reviewQueue.parse(c.queue('1')).items
    expect(items).toHaveLength(17)
    expect(new Set(items.map((i) => i.draftId)).size).toBe(17)
    const added = items.slice(7)
    const warmth = { messaged_us: 0, engaged: 1, follower: 2, adjacent: 3, cold: 4 }
    const rank = (i: (typeof added)[number]) => [i.prospect.fit === 'strong' ? 0 : 1, warmth[i.prospect.relationship], -new Date(i.evidence[0].postedAt!).getTime()]
    for (let n = 1; n < added.length; n++) {
      const a = rank(added[n - 1])
      const b = rank(added[n])
      expect(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])))).toBe(true)
    }
    expect(added.every((i) => i.kind === 'first_message' && i.sentences[0].source?.type === 'greeting' && i.sentences.at(-1)!.source?.type === 'opt_out')).toBe(true)
    expect(added.every((i) => i.prospect.fit === 'strong' || i.prospect.fit === 'possible')).toBe(true)
    // the rest are drafted by the next call, and a call with nobody left writes nothing
    expect((await c.writeDrafts(1, { limit: 10 })).drafted).toBe(before - 10)
    expect((await c.writeDrafts(1, {})).drafted).toBe(0)
    await expect(c.writeDrafts(1, { limit: 11 })).rejects.toThrow(BadRequestException)
  })

  it('drafts one person from the Prospects list by id: any fit but Not a fit, and never without an opening', async () => {
    const made = reviewItem.parse(await c.draftOne(1, 1))
    expect(made.prospect.handle).toBe('lan_speech')
    expect(made.sentences[0].text).toBe('Hi Lan Nguyen!')
    expect(made.sentences.some((s) => s.source?.type === 'evidence')).toBe(true)
    expect(c.queue('1').items.some((i) => i.draftId === made.draftId)).toBe(true)
    await expect(c.draftOne(1, 1)).rejects.toThrow(ConflictException)
    await expect(c.draftOne(1, 15)).rejects.toThrow(/Not a fit/)
    await expect(c.draftOne(1, 13)).rejects.toThrow(/No reason to reach out yet/)
    await expect(c.draftOne(1, 999)).rejects.toThrow(NotFoundException)
  })

  it('takes its people from the campaign\'s real prospects when it is given them, and counts only those', async () => {
    const row = (id: number, handle: string, fit: string | null, opening: object | null, status = 'new') => ({
      id,
      handle,
      name: handle === 'ghost' ? '' : `Name ${handle}`,
      bio: `Bio of ${handle}`,
      relationship: 'cold',
      status,
      fit,
      opening,
    })
    const open = { type: 'launch', summary: 'Shipped v0.4 of our agent tracing tool today.', date: new Date('2026-11-10T08:00:00Z'), freshness: 'fresh', url: 'https://x.com/a/status/55' }
    const rows = [row(1, 'strong_one', 'strong', open), row(2, 'possible_one', 'possible', open), row(3, 'weak_one', 'weak', open), row(4, 'no_opening', 'possible', null), row(5, 'fit_not', 'not_a_fit', open), row(6, 'unscored', null, open), row(7, 'ghost', 'possible', open)]
    const real = new ReviewStubController({ list: async () => rows } as never)
    expect((await real.readyToDraft(1)).ready).toBe(3)
    const one = reviewItem.parse(await real.draftOne(1, 3))
    expect(one.prospect.fit).toBe('weak')
    expect(one.evidence[0].text).toBe(open.summary)
    expect(one.evidence[0].url).toBe(open.url)
    expect(reviewItem.parse(await real.draftOne(1, 7)).sentences[0].text).toMatch(/^(Hi|Hello|Hey)( there)?!$/)
    await expect(real.draftOne(1, 6)).rejects.toThrow(/Not scored yet/)
    const result = await real.writeDrafts(1, {})
    expect(result.drafted).toBe(2)
    expect(result.noOpening).toBe(1)
    const mine = new Set(rows.map((r) => r.handle))
    expect(real.queue('1').items.map((i) => i.prospect.handle).filter((h) => mine.has(h)).sort()).toEqual(['ghost', 'possible_one', 'strong_one', 'weak_one'])
  })

  it('can start with an empty queue, for a demo database', () => {
    process.env.REVIEW_STUB_EMPTY = '1'
    try {
      expect(new ReviewStubController().queue('1').items).toHaveLength(0)
    } finally {
      delete process.env.REVIEW_STUB_EMPTY
    }
  })

  it('rejects a bad campaign id', () => {
    expect(() => c.queue('x')).toThrow(BadRequestException)
  })

  it('edit reruns checks: a new unbacked sentence becomes a warn to confirm, status back to pending', () => {
    const before = item(101)
    const edited = reviewItem.parse(c.edit(101, { text: 'Saw your post on eval tooling. We run a small fund in Singapore. You built the best agent on X. No worries if not.' }))
    expect(edited.editedByReviewer).toBe(true)
    expect(edited.status).toBe('pending')
    expect(edited.contentHash).not.toBe(before.contentHash)
    expect(edited.checks.some((k) => k.code === 'unbacked_claim' && k.level === 'warn' && k.needsConfirm)).toBe(true)
  })

  it('approve needs the hash the reviewer saw and the unbacked confirmation', () => {
    const blocked = c.queue('1').items.find((i) => i.checks.some((k) => k.level === 'block'))!
    expect(() => c.approve(blocked.draftId, { contentHash: blocked.contentHash })).toThrow(ConflictException)

    const clean = c.queue('1').items.find((i) => i.checks.length === 0)!
    expect(() => c.approve(clean.draftId, { contentHash: 'a'.repeat(64) })).toThrow(ConflictException)
    expect(approveResult.parse(c.approve(clean.draftId, { contentHash: clean.contentHash }))).toEqual({ attemptId: expect.any(Number) })
    expect(item(clean.draftId).status).toBe('approved')

    const toConfirm = c.queue('1').items.find((i) => i.checks.some((k) => k.needsConfirm))!
    expect(() => c.approve(toConfirm.draftId, { contentHash: toConfirm.contentHash })).toThrow(ConflictException)
    expect(c.approve(toConfirm.draftId, { contentHash: toConfirm.contentHash, confirmedUnbacked: true })).toHaveProperty('attemptId')
  })

  it('skip needs a reason from the list; skipped drafts cannot be approved', () => {
    expect(() => c.skip(101, { reason: 'bored' })).toThrow(BadRequestException)
    expect(c.skip(101, { reason: 'wrong_tone' }).status).toBe('skipped')
    expect(() => c.approve(101, { contentHash: item(101).contentHash })).toThrow(ConflictException)
  })

  it('manual path records sent / not sent only for approved drafts', () => {
    const handoff = c.queue('1').items.find((i) => i.sendPath === 'HUMAN_HANDOFF' && i.checks.length === 0)!
    expect(() => c.manual(handoff.draftId, { outcome: 'sent' })).toThrow(ConflictException)
    c.approve(handoff.draftId, { contentHash: handoff.contentHash })
    expect(c.manual(handoff.draftId, { outcome: 'sent' }).status).toBe('sent_manually')
  })

  it('a draft the app could send can still be sent by hand once approved', () => {
    const api = c.queue('1').items.find((i) => i.sendPath === 'API_SEND' && i.checks.length === 0)!
    expect(() => c.manual(api.draftId, { outcome: 'sent' })).toThrow(ConflictException)
    c.approve(api.draftId, { contentHash: api.contentHash })
    expect(c.manual(api.draftId, { outcome: 'sent' }).status).toBe('sent_manually')
  })

  it('regenerate replaces the draft text; dnc removes it from the queue', () => {
    const r = c.regenerate(101, { note: 'shorter' })
    expect(r.status).toBe('pending')
    expect(r.text).not.toBe('')
    expect(c.dnc(101)).toEqual({ ok: true })
    expect(c.queue('1').items.some((i) => i.draftId === 101)).toBe(false)
  })

  it('answers 404 for an unknown draft', () => {
    expect(() => c.skip(999, { reason: 'other' })).toThrow(NotFoundException)
  })

  it('reads and saves the sender profile', () => {
    expect(senderProfile.parse(c.profile())).toBeTruthy()
    const next = { intro: 'We back AI founders in SEA.', programs: [{ id: 1, name: 'Intros', description: 'Warm intros to investors.', link: 'https://example.org/intros', deadline: null }], signer: 'Vinh', sampleMessages: [] }
    expect(c.saveProfile(next)).toEqual(next)
    expect(c.profile()).toEqual(next)
    expect(() => c.saveProfile({ intro: '' })).toThrow(BadRequestException)
  })
})
