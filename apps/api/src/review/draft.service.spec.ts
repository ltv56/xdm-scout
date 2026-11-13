import 'reflect-metadata'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Campaign, Prospect } from '../discovery/entities'
import { Claim, Evidence } from '../fit/entities'
import { Job } from '../jobs/job.entity'
import { JobsService } from '../jobs/jobs.service'
import { cannedHandler, FakeLlmClient } from '../llm/fake-llm-client'
import { Contact, DoNotContact, Draft, SenderAccount, XUser } from '../sending/entities'
import { Setting } from '../setting.entity'
import { createTestDataSource } from '../test/db'
import { DraftService } from './draft.service'
import { ReviewSignal } from './review-signal.entity'

let ds: DataSource
const now = new Date('2026-11-12T03:00:00Z')

const profile = { intro: 'GenAI Fund backs early AI founders in Southeast Asia.', programs: [{ id: 1, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null }], signer: 'Vinh', sampleMessages: [] }

async function seed(opts: { fit?: Prospect['fit']; opening?: boolean; handle?: string } = {}) {
  const handle = opts.handle ?? 'mai'
  const xUserId = `u-${handle}`
  await ds.getRepository(Setting).save({ key: 'sender_profile', value: profile })
  await ds.getRepository(SenderAccount).save({ id: 1, xUserId: 'sender', handle: 'genaifund' })
  await ds.getRepository(Campaign).save({ id: 1, name: 'c', keywords: ['ai'], handles: [handle] })
  await ds.getRepository(XUser).save({ xUserId, handle, name: 'Mai' })
  await ds.getRepository(Evidence).save({ id: `post:${handle}1`, xUserId, kind: 'post', url: `https://x.com/${handle}/status/1`, excerpt: 'Shipped v2 of our eval harness', postedAt: new Date('2026-11-08T00:00:00Z'), fetchedAt: now })
  const prospect = await ds.getRepository(Prospect).save({
    campaignId: 1,
    xUserId,
    fit: opts.fit ?? 'strong',
    openingType: opts.opening === false ? 'none' : 'launch',
    openingSummary: opts.opening === false ? null : 'Shipped v2 of our eval harness',
    openingEvidenceId: opts.opening === false ? null : `post:${handle}1`,
    openingDate: new Date('2026-11-08T00:00:00Z'),
    scoredAt: now,
  })
  await ds.getRepository(Claim).save({ prospectId: prospect.id, side: 'for', text: 'Builds eval tooling', evidenceIds: [`post:${handle}1`], status: 'verified' })
  return prospect
}

const service = (llm = new FakeLlmClient(cannedHandler)) => new DraftService(ds, llm, new JobsService(ds))

beforeEach(async () => {
  ds = await createTestDataSource()
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('draft generation', () => {
  it('writes a pending draft whose sentences point at the opening post, the profile and the opt-out line', async () => {
    const p = await seed()
    await service().generate(p.id, now)
    const draft = await ds.getRepository(Draft).findOneByOrFail({ contactId: 1 })
    expect(draft).toMatchObject({ status: 'pending', kind: 'first_message', sendPath: 'HUMAN_HANDOFF', prospectId: p.id, editedByReviewer: false })
    const lines = draft.content.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(draft.sentences![0].text)
    expect(lines[1]).toBe(draft.sentences!.slice(1, -1).map((s) => s.text).join(' '))
    expect(lines[2]).toBe(draft.sentences!.at(-1)!.text)
    expect(draft.originalContent).toBe(draft.content)
    expect(draft.sentences![0]).toMatchObject({ source: { type: 'greeting' } })
    expect(draft.sentences![0].text).toMatch(/^(Hi|Hello|Hey) .*Mai/)
    expect(draft.sentences![1].source).toEqual({ type: 'evidence', evidenceId: 'post:mai1' })
    expect(draft.sentences!.at(-1)!.source).toEqual({ type: 'opt_out' })
  })

  it('fills the operator frame: own greeting, own opt-out line instead of the model\'s, then the contact line', async () => {
    const p = await seed()
    const frame = { greeting: 'Dear {name},', optOut: 'Ignore this if it is not for you.', contactLine: 'Write to vinh@genaifund.ai' }
    await ds.getRepository(Setting).save({ key: 'sender_profile', value: { ...profile, frame } })
    await service().generate(p.id, now)
    const draft = await ds.getRepository(Draft).findOneByOrFail({ contactId: 1 })
    const lines = draft.content.split('\n')
    expect(lines[0]).toBe('Dear Mai,')
    expect(lines.slice(-2)).toEqual(['Ignore this if it is not for you.', 'Write to vinh@genaifund.ai'])
    expect(draft.content).not.toContain('No worries if not.')
    expect(draft.sentences!.at(-2)!.source).toEqual({ type: 'opt_out' })
    expect(draft.sentences!.at(-1)!.source).toEqual({ type: 'sender_profile', field: 'contact' })
  })

  it('uses the plain built-in greeting when the frame greeting needs a name and the person has none', async () => {
    const p = await seed({ handle: 'acme' })
    await ds.getRepository(XUser).update({ xUserId: 'u-acme' }, { name: 'Acme Labs' })
    await ds.getRepository(Setting).save({ key: 'sender_profile', value: { ...profile, frame: { greeting: 'Dear {name},', optOut: null, contactLine: null } } })
    await service().generate(p.id, now)
    const draft = await ds.getRepository(Draft).findOneByOrFail({ contactId: 1 })
    expect(draft.sentences![0].text).not.toContain('Dear')
    expect(draft.sentences!.at(-1)!.source).toEqual({ type: 'opt_out' })
  })

  it('opens with a greeting made in code from the X display name, and drops the name when it is not a person', async () => {
    const p = await seed({ handle: 'acme' })
    await ds.getRepository(XUser).update({ xUserId: 'u-acme' }, { name: 'Acme Labs' })
    await service().generate(p.id, now)
    const draft = await ds.getRepository(Draft).findOneByOrFail({ contactId: 1 })
    expect(draft.sentences![0].source).toEqual({ type: 'greeting' })
    expect(draft.sentences![0].text).not.toContain('Acme')
    expect(draft.sentences![0].text).toMatch(/^(Hi|Hello|Hey)/)
  })

  it('never lets the model write the greeting: the prompt carries no display name', async () => {
    const p = await seed()
    const llm = new FakeLlmClient(cannedHandler)
    await service(llm).generate(p.id, now)
    expect(JSON.stringify(llm.calls)).not.toContain('"Mai"')
  })

  it('creates the contact with the prospect relationship', async () => {
    const p = await seed()
    await ds.getRepository(Prospect).update(p.id, { relationship: 'engaged' })
    await service().generate(p.id, now)
    expect(await ds.getRepository(Contact).findOneByOrFail({ xUserId: 'u-mai' })).toMatchObject({ senderAccountId: 1, relationshipContext: 'engaged', recipientPermission: 'none' })
  })

  it('uses the API path only for a contact with a recent confirmed invitation', async () => {
    const p = await seed()
    await ds.getRepository(Contact).save({ senderAccountId: 1, xUserId: 'u-mai', recipientPermission: 'requested_dm', invitationEventId: 'e1', invitationAt: new Date('2026-11-10T00:00:00Z') })
    await service().generate(p.id, now)
    expect((await ds.getRepository(Draft).findOneByOrFail({ contactId: 1 })).sendPath).toBe('API_SEND')
  })

  it('drops a source that is not the opening, a verified claim or the profile', async () => {
    const p = await seed()
    const llm = new FakeLlmClient(() => ({
      sentences: [
        { text: 'Saw your launch.', source: { type: 'evidence', evidence_id: 'post:not-ours' } },
        { text: 'No worries if not.', source: { type: 'opt_out' } },
      ],
    }))
    await service(llm).generate(p.id, now)
    const sentences = (await ds.getRepository(Draft).findOneByOrFail({ contactId: 1 })).sentences!
    expect(sentences[0].source).toEqual({ type: 'greeting' })
    expect(sentences[1].source).toBeNull()
  })

  it('retries once on invalid model output, then fails', async () => {
    const p = await seed()
    const bad = new FakeLlmClient(() => ({ nope: true }))
    await expect(service(bad).generate(p.id, now)).rejects.toThrow(/invalid model output/)
    expect(bad.calls).toHaveLength(2)
    expect(await ds.getRepository(Draft).count()).toBe(0)
  })

  it('needs the sender profile', async () => {
    const p = await seed()
    await ds.getRepository(Setting).delete({ key: 'sender_profile' })
    await expect(service().generate(p.id, now)).rejects.toThrow(/sender profile/i)
  })

  it('replaces an older pending draft for the same person', async () => {
    const p = await seed()
    await service().generate(p.id, now)
    await service().generate(p.id, now)
    const drafts = await ds.getRepository(Draft).find({ order: { id: 'ASC' } })
    expect(drafts.map((d) => d.status)).toEqual(['superseded', 'pending'])
  })

  it('sends the prompt only the opening, verified claims and the profile', async () => {
    const p = await seed()
    await ds.getRepository(Claim).save({ prospectId: p.id, side: 'for', text: 'Seems senior', evidenceIds: [], status: 'inferred' })
    const llm = new FakeLlmClient(cannedHandler)
    await service(llm).generate(p.id, now)
    const user = JSON.parse(llm.calls[0].user) as { claims: { text: string }[]; opening: { evidence_id: string } }
    expect(llm.calls[0].task).toBe('draft')
    expect(user.claims.map((c) => c.text)).toEqual(['Builds eval tooling'])
    expect(user.opening.evidence_id).toBe('post:mai1')
  })
})

describe('the program in the draft prompt', () => {
  const two = [
    { id: 1, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null },
    { id: 2, name: 'Build week', description: 'Two weeks with our engineers', link: 'https://genaifund.ai/build', deadline: '2026-11-30' },
  ]
  const promptProfile = async (programId: number | null) => {
    const p = await seed()
    await ds.getRepository(Setting).save({ key: 'sender_profile', value: { intro: 'We back founders.', programs: two, signer: 'Vinh', sampleMessages: [] } })
    await ds.getRepository(Campaign).update(1, { programId })
    const llm = new FakeLlmClient(cannedHandler)
    await service(llm).generate(p.id, now)
    return (JSON.parse(llm.calls[0].user) as { profile: { programs: Record<string, string | null>[] } }).profile
  }

  it("offers exactly the campaign's program with its link and deadline", async () => {
    const profile = await promptProfile(2)
    expect(profile.programs).toEqual([{ name: 'Build week', description: 'Two weeks with our engineers', link: 'https://genaifund.ai/build', deadline: 'applications close 30 Nov' }])
  })

  it('falls back to the first program when the campaign has none, with no deadline line', async () => {
    const profile = await promptProfile(null)
    expect(profile.programs).toEqual([{ name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null }])
  })
})

describe('writing drafts for a campaign', () => {
  async function field() {
    const ok = await seed()
    await seed({ handle: 'weak', fit: 'weak' })
    await seed({ handle: 'noopen', opening: false })
    await seed({ handle: 'dnc' })
    await ds.getRepository(DoNotContact).save({ xUserId: 'u-dnc', reason: 'asked', source: 'manual' })
    return ok
  }

  it('counts only people who are ready: Strong or Possible, with an opening, no live draft, not on the do-not-contact list', async () => {
    await field()
    expect(await service().ready(1, now)).toHaveLength(1)
  })

  it('queues one job per chosen person and says what is left and who has no opening', async () => {
    const ok = await field()
    expect(await service().writeDrafts(1, 10, now)).toEqual({ drafted: 1, readyToDraft: 0, noOpening: 1 })
    const jobs = await ds.getRepository(Job).find()
    expect(jobs.map((j) => [j.type, j.payload])).toEqual([['draft', { prospectId: ok.id }]])
  })

  it('does not queue the same person twice', async () => {
    await field()
    await service().writeDrafts(1, 10, now)
    expect(await service().writeDrafts(1, 10, now)).toEqual({ drafted: 0, readyToDraft: 0, noOpening: 1 })
    expect(await ds.getRepository(Job).count()).toBe(1)
  })

  it('stops at the limit and leaves the rest ready', async () => {
    await seed({ handle: 'a' })
    await seed({ handle: 'b' })
    await seed({ handle: 'c' })
    expect(await service().writeDrafts(1, 2, now)).toEqual({ drafted: 2, readyToDraft: 1, noOpening: 0 })
  })
})

describe('drafting again in the language of the recipient', () => {
  const translate = (req: { task: string; user: string }) =>
    req.task === 'translate' ? { sentences: (JSON.parse(req.user) as { sentences: string[] }).sentences.map((text) => ({ text: `[${JSON.parse(req.user).language}] ${text}` })) } : cannedHandler(req as never)
  const svc = (handler: (req: never) => unknown = translate as never) => service(new FakeLlmClient(handler as never))

  it('translates the same sentences in place, keeps their sources, and keeps the English copy', async () => {
    const p = await seed()
    const id = await service().generate(p.id, now)
    const before = await ds.getRepository(Draft).findOneByOrFail({ id })
    await svc().redraft(id, 'vi')
    const after = await ds.getRepository(Draft).findOneByOrFail({ id })
    expect(after.language).toBe('vi')
    expect(after.englishText).toBe(before.content)
    expect(after.content).not.toBe(before.content)
    expect(after.content.split('\n')).toHaveLength(before.content.split('\n').length)
    expect(after.sentences!.map((s) => s.source)).toEqual(before.sentences!.map((s) => s.source))
    expect(after.sentences![0].text).toMatch(/^(Chào|Xin chào)/)
    expect(after.sentences![1].text).toMatch(/^\[Vietnamese\] /)
    expect(after.originalContent).toBe(after.content)
  })

  it('goes back to the English draft exactly, and changes nothing when asked for the language it is in', async () => {
    const p = await seed()
    const id = await service().generate(p.id, now)
    const before = await ds.getRepository(Draft).findOneByOrFail({ id })
    await svc().redraft(id, 'vi')
    await svc().redraft(id, 'th')
    expect((await ds.getRepository(Draft).findOneByOrFail({ id })).englishText).toBe(before.content)
    await svc().redraft(id, 'en')
    const back = await ds.getRepository(Draft).findOneByOrFail({ id })
    expect(back).toMatchObject({ language: 'en', englishText: null, content: before.content, sentences: before.sentences })
    const llm = new FakeLlmClient(translate as never)
    await service(llm).redraft(id, 'en')
    expect(llm.calls).toHaveLength(0)
  })

  it('refuses a reply, a draft the reviewer edited and a draft that is not pending', async () => {
    const p = await seed()
    const id = await service().generate(p.id, now)
    await ds.getRepository(Draft).update(id, { kind: 'reply' })
    await expect(svc().redraft(id, 'vi')).rejects.toBeInstanceOf(ConflictException)
    await ds.getRepository(Draft).update(id, { kind: 'first_message', editedByReviewer: true })
    await expect(svc().redraft(id, 'vi')).rejects.toBeInstanceOf(ConflictException)
    await ds.getRepository(Draft).update(id, { editedByReviewer: false, status: 'skipped' })
    await expect(svc().redraft(id, 'vi')).rejects.toBeInstanceOf(ConflictException)
    await expect(svc().redraft(9999, 'vi')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('fails instead of saving a translation with a different number of sentences', async () => {
    const p = await seed()
    const id = await service().generate(p.id, now)
    const before = await ds.getRepository(Draft).findOneByOrFail({ id })
    await expect(svc(() => ({ sentences: [{ text: 'only one' }] })).redraft(id, 'vi')).rejects.toThrow(/translation/i)
    expect((await ds.getRepository(Draft).findOneByOrFail({ id })).content).toBe(before.content)
  })
})
describe('drafting one person on request', () => {
  it('drafts any Fit but Not a fit, and marks the person shortlisted', async () => {
    const p = await seed({ fit: 'weak' })
    const id = await service().draftOne(1, p.id, now)
    expect((await ds.getRepository(Draft).findOneByOrFail({ id })).prospectId).toBe(p.id)
    expect((await ds.getRepository(Prospect).findOneByOrFail({ id: p.id })).status).toBe('shortlisted')
  })

  it('says why it cannot', async () => {
    const unscored = await seed({ handle: 'u' })
    await ds.getRepository(Prospect).update(unscored.id, { fit: null })
    await expect(service().draftOne(1, unscored.id, now)).rejects.toThrow('Not scored yet')
    const bad = await seed({ handle: 'n', fit: 'not_a_fit' })
    await expect(service().draftOne(1, bad.id, now)).rejects.toThrow('Not a fit')
    const none = await seed({ handle: 'o', opening: false })
    await expect(service().draftOne(1, none.id, now)).rejects.toThrow('No reason to reach out yet')
    const twice = await seed({ handle: 't' })
    await service().draftOne(1, twice.id, now)
    await expect(service().draftOne(1, twice.id, now)).rejects.toThrow('already has a draft')
    await expect(service().draftOne(1, 9999, now)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('dismissing a person', () => {
  it('marks them dismissed, leaves them out of the ready list and records one signal with no handle', async () => {
    const p = await seed()
    expect(await service().ready(1, now)).toHaveLength(1)
    await service().dismiss(1, p.id, 'weak_opening')
    expect((await ds.getRepository(Prospect).findOneByOrFail({ id: p.id })).status).toBe('dismissed')
    expect(await service().ready(1, now)).toHaveLength(0)
    const signals = await ds.getRepository(ReviewSignal).find()
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ action: 'dismiss', reason: 'weak_opening' })
    expect(JSON.stringify(signals[0])).not.toContain('u-mai')
  })

  it('404s for a person who is not in the campaign', async () => {
    await expect(service().dismiss(1, 9999, 'other')).rejects.toBeInstanceOf(NotFoundException)
  })
})

