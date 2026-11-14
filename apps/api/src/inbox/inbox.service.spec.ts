import 'reflect-metadata'
import { ConflictException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Campaign, Prospect } from '../discovery/entities'
import { JobsService } from '../jobs/jobs.service'
import { AttemptStatus, Contact, Draft, SendAttempt } from '../sending/entities'
import { SendingService } from '../sending/sending.service'
import { createTestDataSource } from '../test/db'
import { seedDraft, sha } from '../test/seed'
import { FakeXClient } from '../x/fake-x-client'
import { InboxService } from './inbox.service'
import { Reply } from './reply.entity'

let ds: DataSource
let x: FakeXClient
let sending: SendingService
let inbox: InboxService

async function seedAttempt(campaignId: number, xUserId: string, status: AttemptStatus, route: 'api' | 'manual' = 'manual') {
  if (!(await ds.getRepository(Campaign).findOneBy({ id: campaignId }))) {
    await ds.getRepository(Campaign).save({ id: campaignId, name: `c${campaignId}`, keywords: [], handles: [] })
  }
  const draft = await seedDraft(ds, xUserId, `Hi ${xUserId}`)
  const prospect = await ds.getRepository(Prospect).save({ campaignId, xUserId })
  await ds.getRepository(Draft).update(draft.id, { prospectId: prospect.id, status: 'approved', approvedHash: sha(draft.content) })
  const attempt = await ds.getRepository(SendAttempt).save({ contactId: draft.contactId, draftId: draft.id, route, status, contentHash: sha(draft.content) })
  await ds.getRepository(Contact).update(draft.contactId, { activeAttemptId: attempt.id })
  return { draft, attempt }
}

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  sending = new SendingService(ds, x, new JobsService(ds))
  inbox = new InboxService(ds)
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('checks', () => {
  it('lists sends to check in X and delivered sends of one campaign, with how each was verified', async () => {
    const hand = await seedAttempt(1, '201', 'manual_unverified')
    const timedOut = await seedAttempt(1, '202', 'needs_decision', 'api')
    await seedAttempt(1, '203', 'sent', 'api')
    await ds.getRepository(SendAttempt).update({ status: 'sent' }, { verifiedBy: 'api' })
    await seedAttempt(1, '204', 'queued', 'api')
    await seedAttempt(2, '205', 'manual_unverified')

    const res = await inbox.checks(1)
    expect(res.toCheck.map((c) => [c.attemptId, c.reason])).toEqual([
      [hand.attempt.id, 'sent_by_hand'],
      [timedOut.attempt.id, 'not_confirmed'],
    ])
    expect(res.toCheck[0]).toMatchObject({ handle: 'u201', text: 'Hi 201', openInX: 'https://x.com/messages/compose?recipient_id=201' })
    expect(res.delivered.map((d) => [d.handle, d.verifiedBy])).toEqual([['u203', 'api']])
  })
})

describe('replies', () => {
  it('lists replies with our sent message, newest first, and flags delivered sends that got one', async () => {
    const a = await seedAttempt(1, '201', 'sent', 'api')
    const b = await seedAttempt(1, '202', 'sent', 'api')
    await seedAttempt(1, '203', 'sent', 'api')
    await ds.getRepository(Reply).save([
      { contactId: a.draft.contactId, attemptId: a.attempt.id, xEventId: 'e1', text: 'Tell me more', source: 'api', at: new Date('2026-11-14T01:00:00Z') },
      { contactId: b.draft.contactId, attemptId: b.attempt.id, source: 'operator', at: new Date('2026-11-14T02:00:00Z') },
    ])

    const res = await inbox.checks(1)

    expect(res.replies).toEqual([
      expect.objectContaining({ handle: 'u202', theirText: null, ourText: 'Hi 202', handled: false, openInX: 'https://x.com/messages/compose?recipient_id=202' }),
      expect.objectContaining({ handle: 'u201', theirText: 'Tell me more', ourText: 'Hi 201', at: '2026-11-14T01:00:00.000Z', handled: false }),
    ])
    expect(res.delivered.map((d) => [d.handle, d.replied])).toEqual([
      ['u203', false],
      ['u202', true],
      ['u201', true],
    ])
  })

  it('"Mark handled" keeps the reply but marks it done, once', async () => {
    const a = await seedAttempt(1, '201', 'sent', 'api')
    const reply = await ds.getRepository(Reply).save({ contactId: a.draft.contactId, attemptId: a.attempt.id, xEventId: 'e1', text: 'Hi', source: 'api', at: new Date() })
    await inbox.markHandled(reply.id)
    expect((await inbox.checks(1)).replies.map((r) => r.handled)).toEqual([true])
    await expect(inbox.markHandled(reply.id)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('confirm', () => {
  it('"It was sent" marks the send delivered by the operator and keeps the send right', async () => {
    const { draft, attempt } = await seedAttempt(1, '201', 'manual_unverified')
    await inbox.confirm(attempt.id, 'sent')
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attempt.id })).toMatchObject({ status: 'sent', verifiedBy: 'operator' })
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })).activeAttemptId).toBe(attempt.id)
    expect((await inbox.checks(1)).delivered.map((d) => d.verifiedBy)).toEqual(['operator'])
  })

  it('"It was not sent" frees the send right and puts the draft back for review', async () => {
    const { draft, attempt } = await seedAttempt(1, '202', 'needs_decision', 'api')
    await inbox.confirm(attempt.id, 'not_sent')
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attempt.id })).toMatchObject({ status: 'cancelled' })
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })).activeAttemptId).toBeNull()
    expect(await ds.getRepository(Draft).findOneByOrFail({ id: draft.id })).toMatchObject({ status: 'pending', approvedHash: null })
    expect((await inbox.checks(1)).toCheck).toEqual([])
  })

  it('refuses a send that is not waiting for a check', async () => {
    const { attempt } = await seedAttempt(1, '201', 'manual_unverified')
    await inbox.confirm(attempt.id, 'sent')
    await expect(inbox.confirm(attempt.id, 'not_sent')).rejects.toBeInstanceOf(ConflictException)
    await expect(inbox.confirm(9999, 'sent')).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('API-verified', () => {
  it('a hand send found in the conversation is marked verified by the API', async () => {
    const { draft, attempt } = await seedAttempt(1, '201', 'manual_unverified')
    await x.sendDm('201', draft.content)
    await sending.verifyManual(attempt.id)
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attempt.id })).toMatchObject({ status: 'sent', verifiedBy: 'api' })
  })

  it('an API send that X accepted is marked verified by the API', async () => {
    const { attempt } = await seedAttempt(1, '202', 'queued', 'api')
    await sending.processAttempt(attempt.id)
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attempt.id })).toMatchObject({ status: 'sent', verifiedBy: 'api' })
  })

  it('an unknown send found by reconciliation is marked verified by the API', async () => {
    const { draft, attempt } = await seedAttempt(1, '203', 'unknown', 'api')
    await x.sendDm('203', draft.content)
    await sending.reconcile(attempt.id, new Date())
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attempt.id })).toMatchObject({ status: 'sent', verifiedBy: 'api' })
  })
})
