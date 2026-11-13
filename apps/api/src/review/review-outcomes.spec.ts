import 'reflect-metadata'
import { BadRequestException, ConflictException } from '@nestjs/common'
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
import { ReviewSignal } from './review-signal.entity'
import { ReviewService } from './review.service'

let ds: DataSource
let x: FakeXClient
let sending: SendingService
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

const body = (d: Draft) => ({ contentHash: hashContent(d.content), confirmedUnbacked: false })
const make = (llm: FakeLlmClient) => {
  const jobs = new JobsService(ds)
  return new ReviewActionsService(ds, new ReviewService(ds), sending, new DraftService(ds, llm, jobs), jobs)
}

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  sending = new SendingService(ds, x, new JobsService(ds))
  actions = make(new FakeLlmClient(cannedHandler))
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('skip', () => {
  it('skips with a reason, frees the send right of an approved draft and records a signal without the handle', async () => {
    const d = await seedDraft()
    const { attemptId } = await actions.approve(d.id, body(d), now)
    const item = await actions.skip(d.id, { reason: 'wrong_tone', note: 'too salesy' }, now)
    expect(item.status).toBe('skipped')
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ status: 'cancelled' })
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: d.contactId })).activeAttemptId).toBeNull()
    const signals = await ds.getRepository(ReviewSignal).find({ order: { id: 'ASC' } })
    expect(signals.map((s) => [s.action, s.reason, s.note])).toEqual([
      ['approve', null, null],
      ['skip', 'wrong_tone', 'too salesy'],
    ])
    expect(JSON.stringify(signals)).not.toContain('u-mai')
  })

  it('cannot skip a draft that is already skipped', async () => {
    const d = await seedDraft()
    await actions.skip(d.id, { reason: 'other' }, now)
    await expect(actions.skip(d.id, { reason: 'other' }, now)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('regenerate', () => {
  it('replaces the draft with a new one written with the reviewer note, and records what the AI wrote first', async () => {
    const d = await seedDraft()
    const llm = new FakeLlmClient(cannedHandler)
    const item = await make(llm).regenerate(d.id, 'shorter please', now)
    expect(item.draftId).not.toBe(d.id)
    expect(item.status).toBe('pending')
    expect(JSON.parse(llm.calls[0].user)).toMatchObject({ reviewer_note: 'shorter please' })
    expect((await ds.getRepository(Draft).findOneByOrFail({ id: d.id })).status).toBe('superseded')
    expect(await ds.getRepository(ReviewSignal).findOneByOrFail({ action: 'regenerate' })).toMatchObject({ note: 'shorter please', originalText: d.content })
  })

  it('keeps the old draft when the model fails', async () => {
    const d = await seedDraft()
    await expect(make(new FakeLlmClient(() => ({ nope: 1 }))).regenerate(d.id, 'x', now)).rejects.toThrow(/invalid model output/)
    expect((await ds.getRepository(Draft).findOneByOrFail({ id: d.id })).status).toBe('pending')
  })
})

describe('do not contact', () => {
  it('blocks the person, skips their live drafts and frees the send right', async () => {
    const d = await seedDraft()
    await actions.approve(d.id, body(d), now)
    expect(await actions.doNotContact(d.id)).toEqual({ ok: true })
    expect(await ds.getRepository(DoNotContact).findOneByOrFail({ xUserId: 'u-mai' })).toMatchObject({ source: 'review' })
    expect((await ds.getRepository(Draft).findOneByOrFail({ id: d.id })).status).toBe('skipped')
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: d.contactId })).activeAttemptId).toBeNull()
    expect(await ds.getRepository(ReviewSignal).countBy({ action: 'dnc' })).toBe(1)
  })
})

describe('manual outcome', () => {
  it('"I sent it" shows as sent by hand now; the worker upgrades it to sent once the message is in the conversation', async () => {
    const d = await seedDraft()
    const { attemptId } = await actions.approve(d.id, body(d), now)
    const item = await actions.manual(d.id, 'sent', now)
    expect(item.status).toBe('sent_manually')
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ status: 'manual_unverified' })
    expect(await ds.getRepository(Job).countBy({ type: 'verify_manual' })).toBe(1)

    await sending.verifyManual(attemptId)
    expect((await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).status).toBe('manual_unverified')
    await x.sendDm('u-mai', d.content)
    await sending.verifyManual(attemptId)
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ status: 'sent' })
    await expect(actions.manual(d.id, 'sent', now)).rejects.toBeInstanceOf(ConflictException)
  })

  it('"I did not send" cancels the attempt, frees the send right and puts the draft back for review', async () => {
    const d = await seedDraft()
    const { attemptId } = await actions.approve(d.id, body(d), now)
    const item = await actions.manual(d.id, 'not_sent', now)
    expect(item.status).toBe('not_sent')
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ status: 'cancelled' })
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: d.contactId })).activeAttemptId).toBeNull()
    expect((await ds.getRepository(Draft).findOneByOrFail({ id: d.id })).status).toBe('pending')
  })

  it('only applies to an approved draft', async () => {
    const d = await seedDraft()
    await expect(actions.manual(d.id, 'sent', now)).rejects.toBeInstanceOf(ConflictException)
    await ds.getRepository(Draft).update(d.id, { sendPath: 'API_SEND' })
    await expect(actions.manual(d.id, 'sent', now)).rejects.toBeInstanceOf(ConflictException)
  })

  it('a draft the app could send can still be sent by hand once approved, on the same attempt', async () => {
    const d = await seedDraft()
    await ds.getRepository(Contact).update(d.contactId, { recipientPermission: 'requested_dm', invitationEventId: 'e1', invitationAt: new Date(Date.now() - 86_400_000) })
    await ds.getRepository(Draft).update(d.id, { sendPath: 'API_SEND' })
    await expect(actions.manual(d.id, 'sent', now)).rejects.toBeInstanceOf(ConflictException)
    const { attemptId } = await actions.approve(d.id, body(d), new Date())
    expect((await actions.manual(d.id, 'sent', now)).status).toBe('sent_manually')
    expect(await ds.getRepository(SendAttempt).find()).toMatchObject([{ id: attemptId, route: 'manual', status: 'manual_unverified' }])
    expect(await ds.getRepository(Job).countBy({ type: 'verify_manual' })).toBe(1)
    expect(await ds.getRepository(Job).countBy({ type: 'send' })).toBe(0)
  })
})

describe('signals', () => {
  it("records the AI's text next to the reviewer's final text when an edited draft is approved", async () => {
    const d = await seedDraft()
    const edited = await actions.edit(d.id, `${d.sentences![0].text} No worries if not.`, now)
    await actions.approve(d.id, { contentHash: edited.contentHash, confirmedUnbacked: false }, now)
    expect(await ds.getRepository(ReviewSignal).findOneByOrFail({ action: 'approve' })).toMatchObject({ originalText: d.content, finalText: edited.text })
  })
})

describe('routes', () => {
  it('rejects malformed bodies', async () => {
    const controller = new ReviewActionsController(actions)
    await expect(controller.skip(1, { reason: 'bored' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.regenerate(1, { note: '' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.manual(1, { outcome: 'maybe' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.send(1, { contentHash: 'short' })).rejects.toBeInstanceOf(BadRequestException)
  })
})
