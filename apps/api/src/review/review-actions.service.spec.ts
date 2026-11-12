import 'reflect-metadata'
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Campaign, Prospect, XPost } from '../discovery/entities'
import { Claim, Evidence } from '../fit/entities'
import { Job } from '../jobs/job.entity'
import { JobsService } from '../jobs/jobs.service'
import { cannedHandler, FakeLlmClient } from '../llm/fake-llm-client'
import { Contact, DoNotContact, Draft, SendAttempt, SenderAccount, XUser } from '../sending/entities'
import { hashContent, SendingService } from '../sending/sending.service'
import { Setting } from '../setting.entity'
import { createTestDataSource } from '../test/db'
import { FakeXClient } from '../x/fake-x-client'
import { DraftService } from './draft.service'
import { ReviewActionsController } from './review-actions.controller'
import { ReviewActionsService } from './review-actions.service'
import { ReviewService } from './review.service'

let ds: DataSource
let actions: ReviewActionsService
const now = new Date('2026-11-12T03:00:00Z')
const profile = { intro: 'GenAI Fund backs early AI founders in Southeast Asia.', programs: [{ id: 1, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null }], signer: 'Vinh', sampleMessages: [] }

async function seedDraft(handle = 'mai') {
  const xUserId = `u-${handle}`
  await ds.getRepository(Setting).save({ key: 'sender_profile', value: profile })
  await ds.getRepository(SenderAccount).save({ id: 1, xUserId: 'sender', handle: 'genaifund' })
  if (!(await ds.getRepository(Campaign).findOneBy({ id: 1 }))) await ds.getRepository(Campaign).save({ id: 1, name: 'c', keywords: ['ai'], handles: [handle] })
  await ds.getRepository(XUser).save({ xUserId, handle, name: handle })
  const postedAt = new Date('2026-11-08T00:00:00Z')
  await ds.getRepository(XPost).save({ postId: `${handle}1`, xUserId, text: 'Shipped v2', postedAt, fetchedAt: now })
  await ds.getRepository(Evidence).save({ id: `post:${handle}1`, xUserId, kind: 'post', url: `https://x.com/${handle}/status/1`, excerpt: 'Shipped v2', postedAt, fetchedAt: now })
  const prospect = await ds.getRepository(Prospect).save({ campaignId: 1, xUserId, fit: 'strong', openingType: 'launch', openingSummary: 'Shipped v2', openingEvidenceId: `post:${handle}1`, openingDate: postedAt, scoredAt: now })
  await ds.getRepository(Claim).save({ prospectId: prospect.id, side: 'for', text: 'Ships', evidenceIds: [`post:${handle}1`], status: 'verified' })
  await new DraftService(ds, new FakeLlmClient(cannedHandler), new JobsService(ds)).generate(prospect.id, now)
  return ds.getRepository(Draft).findOneByOrFail({ prospectId: prospect.id })
}

beforeEach(async () => {
  ds = await createTestDataSource()
  const jobs = new JobsService(ds)
  actions = new ReviewActionsService(ds, new ReviewService(ds), new SendingService(ds, new FakeXClient(), jobs), new DraftService(ds, new FakeLlmClient(cannedHandler), jobs), jobs)
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('edit', () => {
  it('keeps the source of sentences the reviewer left alone and marks the new ones as theirs', async () => {
    const d = await seedDraft()
    // sentences[0] is the greeting made by the app, sentences[1] the one about their post
    const text = `${d.sentences![0].text} ${d.sentences![1].text} We met at the Saigon meetup last year. No worries if not.`
    const item = await actions.edit(d.id, text, now)
    expect(item.editedByReviewer).toBe(true)
    expect(item.status).toBe('pending')
    expect(item.text).toBe(text)
    expect(item.contentHash).toBe(hashContent(text))
    expect(item.sentences.map((s) => s.source?.type ?? null)).toEqual(['greeting', 'evidence', null, 'opt_out'])
    expect(item.checks.find((c) => c.code === 'unbacked_claim')).toMatchObject({ level: 'warn', needsConfirm: true })
  })

  it('sends an approved draft back to pending and cancels its open manual attempt', async () => {
    const d = await seedDraft()
    const { attemptId } = await actions.approve(d.id, { contentHash: hashContent(d.content), confirmedUnbacked: false }, now)
    const item = await actions.edit(d.id, `${d.sentences![0].text} No worries if not.`, now)
    expect(item.status).toBe('pending')
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ status: 'cancelled' })
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: d.contactId })).activeAttemptId).toBeNull()
  })

  it('refuses to edit a skipped draft', async () => {
    const d = await seedDraft()
    await ds.getRepository(Draft).update(d.id, { status: 'skipped' })
    await expect(actions.edit(d.id, 'Hello. No worries if not.', now)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('approve', () => {
  it('opens a manual attempt for a hand-off draft: approved, send right taken, nothing queued for the API', async () => {
    const d = await seedDraft()
    const { attemptId } = await actions.approve(d.id, { contentHash: hashContent(d.content), confirmedUnbacked: false }, now)
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ route: 'manual', status: 'manual_pending', draftId: d.id })
    expect(await ds.getRepository(Draft).findOneByOrFail({ id: d.id })).toMatchObject({ status: 'approved', approvedHash: hashContent(d.content) })
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: d.contactId })).activeAttemptId).toBe(attemptId)
    expect(await ds.getRepository(Job).countBy({ type: 'send' })).toBe(0)
  })

  it('queues an API send for a person who messaged first', async () => {
    const d = await seedDraft()
    await ds.getRepository(Contact).update(d.contactId, { recipientPermission: 'requested_dm', invitationEventId: 'e1', invitationAt: new Date(Date.now() - 86_400_000) })
    await ds.getRepository(Draft).update(d.id, { sendPath: 'API_SEND' })
    const { attemptId } = await actions.approve(d.id, { contentHash: hashContent(d.content), confirmedUnbacked: false }, new Date())
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ route: 'api', status: 'queued' })
    expect(await ds.getRepository(Job).countBy({ type: 'send' })).toBe(1)
  })

  it('refuses a draft with a blocking check', async () => {
    const d = await seedDraft()
    await ds.getRepository(Draft).update(d.id, { sentences: [{ text: 'You are the best.', source: null }, { text: 'No worries if not.', source: { type: 'opt_out' } }], content: 'You are the best. No worries if not.' })
    await expect(actions.approve(d.id, { contentHash: hashContent('You are the best. No worries if not.'), confirmedUnbacked: false }, now)).rejects.toThrow(/blocking/)
  })

  it('refuses a hash that is not the draft the reviewer read', async () => {
    const d = await seedDraft()
    await expect(actions.approve(d.id, { contentHash: 'a'.repeat(64), confirmedUnbacked: false }, now)).rejects.toThrow(/changed/)
  })

  it('needs the tick for sentences the reviewer added without a post behind them', async () => {
    const d = await seedDraft()
    const edited = await actions.edit(d.id, `${d.sentences![0].text} We met at the meetup. No worries if not.`, now)
    await expect(actions.approve(d.id, { contentHash: edited.contentHash, confirmedUnbacked: false }, now)).rejects.toThrow(/Confirm/)
    await expect(actions.approve(d.id, { contentHash: edited.contentHash, confirmedUnbacked: true }, now)).resolves.toHaveProperty('attemptId')
  })

  it('cannot approve twice', async () => {
    const d = await seedDraft()
    const body = { contentHash: hashContent(d.content), confirmedUnbacked: false }
    await actions.approve(d.id, body, now)
    await expect(actions.approve(d.id, body, now)).rejects.toBeInstanceOf(ConflictException)
  })

  it('refuses a person on the do-not-contact list', async () => {
    const d = await seedDraft()
    await ds.getRepository(DoNotContact).save({ xUserId: 'u-mai', reason: 'asked', source: 'manual' })
    await expect(actions.approve(d.id, { contentHash: hashContent(d.content), confirmedUnbacked: false }, now)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('approves a draft that has no sentence breakdown (created before drafts were generated) without the checks', async () => {
    const d = await seedDraft()
    await ds.getRepository(Draft).update(d.id, { sentences: null, content: 'Hi there' })
    await expect(actions.approve(d.id, { contentHash: hashContent('Hi there'), confirmedUnbacked: false }, now)).resolves.toHaveProperty('attemptId')
  })
})

describe('routes', () => {
  it('rejects malformed bodies', async () => {
    const controller = new ReviewActionsController(actions)
    await expect(controller.approve(1, {})).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.edit(1, { text: '' })).rejects.toBeInstanceOf(BadRequestException)
  })
})
