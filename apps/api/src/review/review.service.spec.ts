import 'reflect-metadata'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Campaign, Prospect, XPost } from '../discovery/entities'
import { Claim, Evidence } from '../fit/entities'
import { JobsService } from '../jobs/jobs.service'
import { cannedHandler, FakeLlmClient } from '../llm/fake-llm-client'
import { Contact, Draft, SenderAccount, XUser } from '../sending/entities'
import { hashContent } from '../sending/sending.service'
import { Setting } from '../setting.entity'
import { createTestDataSource } from '../test/db'
import { FixtureDecisionClient } from '../decisions/decision-client'
import { reviewQueue } from './contract'
import { DraftService } from './draft.service'
import { ReviewController } from './review.controller'
import { ReviewService } from './review.service'

let ds: DataSource
const now = new Date('2026-11-12T03:00:00Z')
const profile = { intro: 'GenAI Fund backs early AI founders in Southeast Asia.', programs: [{ id: 1, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null }], signer: 'Vinh', sampleMessages: [] }

async function seedPerson(handle: string, campaignId = 1) {
  const xUserId = `u-${handle}`
  await ds.getRepository(Setting).save({ key: 'sender_profile', value: profile })
  await ds.getRepository(SenderAccount).save({ id: 1, xUserId: 'sender', handle: 'genaifund' })
  if (!(await ds.getRepository(Campaign).findOneBy({ id: campaignId }))) await ds.getRepository(Campaign).save({ id: campaignId, name: 'c', keywords: ['ai'], handles: [handle] })
  await ds.getRepository(XUser).save({ xUserId, handle, name: handle.toUpperCase(), followers: 3400 })
  const postedAt = new Date('2026-11-08T00:00:00Z')
  await ds.getRepository(XPost).save([
    { postId: `${handle}1`, xUserId, text: 'Shipped v2 of our eval harness', postedAt, fetchedAt: now },
    { postId: `${handle}2`, xUserId, text: 'Older post', postedAt: new Date('2026-10-25T00:00:00Z'), fetchedAt: now },
  ])
  await ds.getRepository(Evidence).save({ id: `post:${handle}1`, xUserId, kind: 'post', url: `https://x.com/${handle}/status/1`, excerpt: 'Shipped v2 of our eval harness', postedAt, fetchedAt: now })
  const prospect = await ds.getRepository(Prospect).save({
    campaignId,
    xUserId,
    fit: 'strong',
    role: 'builder',
    seedCount: 2,
    openingType: 'launch',
    openingSummary: 'Shipped v2 of our eval harness',
    openingEvidenceId: `post:${handle}1`,
    openingDate: postedAt,
    criteria: [{ text: 'Based in SEA', status: 'unknown', evidenceIds: [] }],
    scoredAt: now,
  })
  await ds.getRepository(Claim).save({ prospectId: prospect.id, side: 'for', text: 'Builds eval tooling', evidenceIds: [`post:${handle}1`], status: 'verified' })
  await new DraftService(ds, new FakeLlmClient(cannedHandler), new JobsService(ds)).generate(prospect.id, now)
  return prospect
}

const service = () => new ReviewService(ds)

beforeEach(async () => {
  ds = await createTestDataSource()
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('review queue', () => {
  it('returns drafts in the shape the web app parses, with the opening post as evidence', async () => {
    await seedPerson('mai')
    const q = reviewQueue.parse(await service().queue(1, now))
    expect(q).toMatchObject({ campaignId: 1, sessionSize: 10 })
    const item = q.items[0]
    expect(item).toMatchObject({ status: 'pending', kind: 'first_message', sendPath: 'HUMAN_HANDOFF', editedByReviewer: false, checks: [], decisions: [] })
    expect(item.contentHash).toBe(hashContent(item.text))
    expect(item.prospect).toMatchObject({ handle: 'mai', name: 'MAI', fit: 'strong', relationship: 'cold', daysSinceActive: 4 })
    expect(item.evidence).toEqual([{ id: 1, kind: 'post', text: 'Shipped v2 of our eval harness', url: 'https://x.com/mai/status/1', postedAt: '2026-11-08T00:00:00.000Z' }])
    expect(item.sentences[0].source).toEqual({ type: 'evidence', evidenceId: 1 })
    expect(item.prospect.criteria).toEqual([{ text: 'Based in SEA', status: 'unknown', evidence: [], fact: null }])
  })

  it('computes the numbers from posts we read, dated and with their sample size', async () => {
    await seedPerson('mai')
    const { snapshot } = (await service().queue(1, now)).items[0].prospect
    expect(snapshot).toMatchObject({ asOf: now.toISOString(), sampleSize: 2, followers: 3400, engagementMedian: null, contribution: 'builder', fundTies: 2 })
    expect(snapshot.postsPerWeek).toBeCloseTo(1, 0)
  })

  it('gives hand-off drafts an Open in X link with the draft prefilled, and API drafts none', async () => {
    await seedPerson('mai')
    await seedPerson('linh')
    await ds.getRepository(Contact).update({ xUserId: 'u-linh' }, { recipientPermission: 'requested_dm', invitationEventId: 'e1', invitationAt: new Date('2026-11-10T00:00:00Z') })
    await ds.getRepository(Draft).update({ contactId: (await ds.getRepository(Contact).findOneByOrFail({ xUserId: 'u-linh' })).id }, { sendPath: 'API_SEND' })
    const items = (await service().queue(1, now)).items
    const mai = items.find((i) => i.prospect.handle === 'mai')!
    const linh = items.find((i) => i.prospect.handle === 'linh')!
    expect(mai.openInXUrl).toBe(`https://x.com/messages/compose?recipient_id=u-mai&text=${encodeURIComponent(mai.text)}`)
    expect(linh.openInXUrl).toBeNull()
  })

  it('adds the model checks when a decision client is there, and none otherwise', async () => {
    await seedPerson('mai')
    expect((await service().queue(1, now)).items[0].decisions).toEqual([])
    const withModel = reviewQueue.parse(await new ReviewService(ds, new FixtureDecisionClient(() => 0.9)).queue(1, now))
    const codes = withModel.items[0].decisions.map((d) => d.code)
    expect(codes).toEqual(expect.arrayContaining(['no_sensitive', 'no_familiarity', 'one_person', 'claim_backed', 'own_account']))
    expect(withModel.items[0].decisions.every((d) => d.answeredBy === 'fixture' && d.band === 'high')).toBe(true)
  })

  it('shows pending and approved drafts of this campaign only, at most ten', async () => {
    await seedPerson('mai')
    await seedPerson('other', 2)
    const skipped = await seedPerson('skip')
    await ds.getRepository(Draft).update({ prospectId: skipped.id }, { status: 'skipped' })
    const approved = await seedPerson('ok')
    await ds.getRepository(Draft).update({ prospectId: approved.id }, { status: 'approved' })
    const items = (await service().queue(1, now)).items
    expect(items.map((i) => [i.prospect.handle, i.status])).toEqual([['mai', 'pending'], ['ok', 'approved']])
    for (let i = 0; i < 11; i++) await seedPerson(`p${i}`)
    expect((await service().queue(1, now)).items).toHaveLength(10)
  })

  it('blocks and explains a draft with a sentence nobody backs', async () => {
    const p = await seedPerson('mai')
    const draft = await ds.getRepository(Draft).findOneByOrFail({ prospectId: p.id })
    await ds.getRepository(Draft).update(draft.id, { sentences: [{ text: 'You built the best agent platform in Singapore.', source: null }, ...draft.sentences!.slice(1)] })
    const item = (await service().queue(1, now)).items[0]
    expect(item.checks.map((c) => `${c.level}:${c.code}`)).toContain('block:unbacked_claim')
    expect(item.weakestPoint).toMatch(/no post behind it/)
    expect(item.sentences[0].source).toBeNull()
  })

  it('names the thinnest backing when everything is backed', async () => {
    await seedPerson('mai')
    expect((await service().queue(1, now)).items[0].weakestPoint).toBe('Rests on one post from 4 days ago; 1 criterion unknown.')
  })

  it('warns about a near-identical draft in the same queue', async () => {
    await seedPerson('mai')
    await seedPerson('mai2')
    const same = [
      { text: 'Saw your post about the eval harness and wanted to say hello.', source: { type: 'evidence' as const, evidenceId: 'post:mai1' } },
      { text: 'No worries if not.', source: { type: 'opt_out' as const } },
    ]
    await ds.createQueryBuilder().update(Draft).set({ sentences: same, content: same.map((s) => s.text).join(' ') }).execute()
    const items = (await service().queue(1, now)).items
    expect(items.every((i) => i.checks.some((c) => c.code === 'similar_draft'))).toBe(true)
  })

  it('previews the first 60 characters as approximate, with the post it mentions', async () => {
    await seedPerson('mai')
    const preview = (await service().queue(1, now)).items[0].recipientPreview
    expect(preview).toMatchObject({ senderHandle: 'genaifund', approximate: true, post: { url: 'https://x.com/mai/status/1' } })
    expect(preview.firstLine).toHaveLength(60)
  })
})

describe('review queue route', () => {
  it('rejects a bad campaign id and answers 404 for an unknown campaign', async () => {
    const controller = new ReviewController(ds, service())
    await expect(controller.queue('x')).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.queue('99')).rejects.toBeInstanceOf(NotFoundException)
  })
})
