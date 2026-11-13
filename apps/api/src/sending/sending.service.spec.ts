import 'reflect-metadata'
import { ConflictException, ForbiddenException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Job } from '../jobs/job.entity'
import { JobsService } from '../jobs/jobs.service'
import { createTestDataSource } from '../test/db'
import { seedDraft as seed, sha } from '../test/seed'
import { FakeXClient } from '../x/fake-x-client'
import { Contact, DoNotContact, Draft, SendAttempt } from './entities'
import { SendingService } from './sending.service'

let ds: DataSource
let x: FakeXClient
let service: SendingService

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  service = new SendingService(ds, x, new JobsService(ds))
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

const seedDraft = (xUserId = '200', content = 'Hi there') => seed(ds, xUserId, content)
const sendJobs = () => ds.getRepository(Job).countBy({ type: 'send' })
const queued = async (draft: Draft) => {
  await service.approve(draft.id, sha(draft.content))
  return service.send(draft.id, sha(draft.content))
}

describe('approve', () => {
  it('holds the send right in an approved attempt and queues nothing', async () => {
    const draft = await seedDraft()
    const { attemptId } = await service.approve(draft.id, sha(draft.content))
    expect(await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).toMatchObject({ status: 'approved', route: 'api' })
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })).activeAttemptId).toBe(attemptId)
    expect(await ds.getRepository(Draft).findOneByOrFail({ id: draft.id })).toMatchObject({ status: 'approved', approvedHash: sha(draft.content) })
    expect(await sendJobs()).toBe(0)
  })

  it('the worker never picks up an approved attempt', async () => {
    const draft = await seedDraft()
    const { attemptId } = await service.approve(draft.id, sha(draft.content))
    expect(await new JobsService(ds).claimNext(new Date())).toBeNull()
    await service.processAttempt(attemptId)
    expect((await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).status).toBe('approved')
    expect(x.sendCalls).toBe(0)
  })

  it('test 1: second click says Already queued, one attempt', async () => {
    const draft = await seedDraft()
    await service.approve(draft.id, sha(draft.content))
    await expect(service.approve(draft.id, sha(draft.content))).rejects.toThrow('Already queued')
    expect(await ds.getRepository(SendAttempt).count()).toBe(1)
  })

  it('test 2: two parallel approvals create one attempt', async () => {
    const draft = await seedDraft()
    const results = await Promise.allSettled([
      service.approve(draft.id, sha(draft.content)),
      service.approve(draft.id, sha(draft.content)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await ds.getRepository(SendAttempt).count()).toBe(1)
  })

  it('test 3: a second draft for the same person cannot send', async () => {
    const first = await seedDraft()
    const second = await ds.getRepository(Draft).save({ contactId: first.contactId, content: 'Other opening' })
    await service.approve(first.id, sha(first.content))
    await expect(service.approve(second.id, sha(second.content))).rejects.toThrow('Already queued')
    expect(await ds.getRepository(SendAttempt).count()).toBe(1)
  })

  it('rejects when the content hash differs from what the reviewer saw', async () => {
    const draft = await seedDraft()
    await expect(service.approve(draft.id, sha('something else'))).rejects.toThrow('changed')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('rejects a person on Do not contact', async () => {
    const draft = await seedDraft()
    await ds.getRepository(DoNotContact).save({ xUserId: '200', reason: 'asked to stop', source: 'test' })
    await expect(service.approve(draft.id, sha(draft.content))).rejects.toThrow('Do not contact')
  })

  it('test 18: a person who never messaged first cannot be sent by API', async () => {
    const draft = await seed(ds, '200', 'Hi there', { recipientPermission: 'none', invitationEventId: null, invitationAt: null })
    await expect(service.approve(draft.id, sha(draft.content))).rejects.toThrow('messaged you first')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('requested_dm without the invitation DM on record is not enough', async () => {
    const draft = await seed(ds, '200', 'Hi there', { invitationEventId: null })
    await expect(service.approve(draft.id, sha(draft.content))).rejects.toThrow('messaged you first')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('rejects a draft that was skipped or replaced', async () => {
    const draft = await seedDraft()
    await ds.getRepository(Draft).update(draft.id, { status: 'skipped' })
    await expect(service.approve(draft.id, sha(draft.content))).rejects.toThrow('no longer')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('an invitation older than 30 days moves the person to sending by hand', async () => {
    const draft = await seed(ds, '200', 'Hi there', { invitationAt: new Date(Date.now() - 31 * 86_400_000) })
    await expect(service.approve(draft.id, sha(draft.content))).rejects.toThrow('older than 30 days')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })
})

describe('send', () => {
  it('moves the approved attempt to queued and enqueues one job', async () => {
    const draft = await seedDraft()
    const { attemptId } = await service.approve(draft.id, sha(draft.content))
    expect(await service.send(draft.id, sha(draft.content))).toEqual({ attemptId })
    expect((await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).status).toBe('queued')
    expect(await sendJobs()).toBe(1)
  })

  it('sending twice, also in parallel, gives one job', async () => {
    const draft = await seedDraft()
    await service.approve(draft.id, sha(draft.content))
    const results = await Promise.allSettled([service.send(draft.id, sha(draft.content)), service.send(draft.id, sha(draft.content))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    await expect(service.send(draft.id, sha(draft.content))).rejects.toBeInstanceOf(ConflictException)
    expect(await sendJobs()).toBe(1)
  })

  it('needs the hash that was approved', async () => {
    const draft = await seedDraft()
    const { attemptId } = await service.approve(draft.id, sha(draft.content))
    await expect(service.send(draft.id, sha('something else'))).rejects.toThrow('The draft changed since you read it')
    await ds.getRepository(Draft).update(draft.id, { content: 'Changed in the database' })
    await expect(service.send(draft.id, sha('Changed in the database'))).rejects.toThrow('The draft changed since you read it')
    expect((await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })).status).toBe('approved')
    expect(await sendJobs()).toBe(0)
  })

  it('refuses a draft that was not approved', async () => {
    const draft = await seedDraft()
    await expect(service.send(draft.id, sha(draft.content))).rejects.toBeInstanceOf(ConflictException)
    expect(await sendJobs()).toBe(0)
  })

  it('checks Do not contact and the invitation again', async () => {
    const draft = await seedDraft()
    await service.approve(draft.id, sha(draft.content))
    await ds.getRepository(Contact).update(draft.contactId, { invitationAt: new Date(Date.now() - 31 * 86_400_000) })
    await expect(service.send(draft.id, sha(draft.content))).rejects.toThrow('older than 30 days')
    await ds.getRepository(Contact).update(draft.contactId, { invitationAt: new Date() })
    await ds.getRepository(DoNotContact).save({ xUserId: '200', reason: 'asked to stop', source: 'test' })
    await expect(service.send(draft.id, sha(draft.content))).rejects.toBeInstanceOf(ForbiddenException)
    expect(await sendJobs()).toBe(0)
  })

  it('refuses when the attempt no longer holds the send right', async () => {
    const draft = await seedDraft()
    await service.approve(draft.id, sha(draft.content))
    await ds.getRepository(Contact).update(draft.contactId, { activeAttemptId: null })
    await expect(service.send(draft.id, sha(draft.content))).rejects.toBeInstanceOf(ConflictException)
    expect(await sendJobs()).toBe(0)
  })
})

describe('processAttempt', () => {
  it('sends once and marks the attempt sent', async () => {
    const draft = await seedDraft()
    const { attemptId } = await queued(draft)
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('sent')
    expect(attempt.xEventId).toBeTruthy()
    expect(x.sent).toEqual([{ recipientId: '200', text: 'Hi there' }])
  })

  it('never sends text that differs from the approved hash', async () => {
    const draft = await seedDraft()
    const { attemptId } = await queued(draft)
    await ds.getRepository(Draft).update(draft.id, { content: 'Edited after approval' })
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('cancelled')
    expect(attempt.error).toContain('changed after approval')
    expect(x.sendCalls).toBe(0)
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })).activeAttemptId).toBeNull()
  })

  it('a definite error from X fails the attempt and frees the send right', async () => {
    const draft = await seedDraft()
    x.nextSend = 'rejected'
    const { attemptId } = await queued(draft)
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('failed')
    expect(attempt.error).toContain('X returned 400')
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })).activeAttemptId).toBeNull()
  })

  it('test 8: recipient not accepting DMs -> failed, send right released', async () => {
    const draft = await seedDraft()
    x.nextSend = 'not-accepting'
    const { attemptId } = await queued(draft)
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('failed')
    expect(attempt.error).toContain("doesn't accept DMs from this account")
    const contact = await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })
    expect(contact.activeAttemptId).toBeNull()
  })
})
