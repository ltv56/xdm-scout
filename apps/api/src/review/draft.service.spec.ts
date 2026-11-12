import 'reflect-metadata'
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
    expect(draft.content).toBe(draft.sentences!.map((s) => s.text).join(' '))
    expect(draft.sentences![0]).toMatchObject({ source: { type: 'greeting' } })
    expect(draft.sentences![0].text).toMatch(/^(Hi|Hello|Hey) .*Mai/)
    expect(draft.sentences![1].source).toEqual({ type: 'evidence', evidenceId: 'post:mai1' })
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

describe('queueing drafts for a campaign', () => {
  it('queues one job per strong or possible prospect with an opening, no live draft and not on the do-not-contact list', async () => {
    const ok = await seed()
    await seed({ handle: 'weak', fit: 'weak' })
    await seed({ handle: 'noopen', opening: false })
    await seed({ handle: 'dnc' })
    await ds.getRepository(DoNotContact).save({ xUserId: 'u-dnc', reason: 'asked', source: 'manual' })
    expect(await service().enqueueForCampaign(1)).toEqual({ queued: 1 })
    const jobs = await ds.getRepository(Job).find()
    expect(jobs.map((j) => [j.type, j.payload])).toEqual([['draft', { prospectId: ok.id }]])
  })
})
