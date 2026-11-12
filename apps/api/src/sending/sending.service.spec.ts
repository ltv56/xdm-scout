import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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

describe('approveAndSend', () => {
  it('creates one queued attempt and holds the send right', async () => {
    const draft = await seedDraft()
    const { attemptId } = await service.approveAndSend(draft.id, sha(draft.content))
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('queued')
    const contact = await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })
    expect(contact.activeAttemptId).toBe(attemptId)
  })

  it('test 1: second click says Already queued, one attempt', async () => {
    const draft = await seedDraft()
    await service.approveAndSend(draft.id, sha(draft.content))
    await expect(service.approveAndSend(draft.id, sha(draft.content))).rejects.toThrow('Already queued')
    expect(await ds.getRepository(SendAttempt).count()).toBe(1)
  })

  it('test 2: two parallel approvals create one attempt', async () => {
    const draft = await seedDraft()
    const results = await Promise.allSettled([
      service.approveAndSend(draft.id, sha(draft.content)),
      service.approveAndSend(draft.id, sha(draft.content)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await ds.getRepository(SendAttempt).count()).toBe(1)
  })

  it('test 3: a second draft for the same person cannot send', async () => {
    const first = await seedDraft()
    const second = await ds.getRepository(Draft).save({ contactId: first.contactId, content: 'Other opening' })
    await service.approveAndSend(first.id, sha(first.content))
    await expect(service.approveAndSend(second.id, sha(second.content))).rejects.toThrow('Already queued')
    expect(await ds.getRepository(SendAttempt).count()).toBe(1)
  })

  it('rejects when the content hash differs from what the reviewer saw', async () => {
    const draft = await seedDraft()
    await expect(service.approveAndSend(draft.id, sha('something else'))).rejects.toThrow('changed')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('rejects a person on Do not contact', async () => {
    const draft = await seedDraft()
    await ds.getRepository(DoNotContact).save({ xUserId: '200', reason: 'asked to stop', source: 'test' })
    await expect(service.approveAndSend(draft.id, sha(draft.content))).rejects.toThrow('Do not contact')
  })

  it('test 18: a person who never messaged first cannot be sent by API', async () => {
    const draft = await seed(ds, '200', 'Hi there', { recipientPermission: 'none', invitationEventId: null, invitationAt: null })
    await expect(service.approveAndSend(draft.id, sha(draft.content))).rejects.toThrow('messaged you first')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('requested_dm without the invitation DM on record is not enough', async () => {
    const draft = await seed(ds, '200', 'Hi there', { invitationEventId: null })
    await expect(service.approveAndSend(draft.id, sha(draft.content))).rejects.toThrow('messaged you first')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('rejects a draft that was skipped or replaced', async () => {
    const draft = await seedDraft()
    await ds.getRepository(Draft).update(draft.id, { status: 'skipped' })
    await expect(service.approveAndSend(draft.id, sha(draft.content))).rejects.toThrow('no longer')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })

  it('an invitation older than 30 days moves the person to sending by hand', async () => {
    const draft = await seed(ds, '200', 'Hi there', { invitationAt: new Date(Date.now() - 31 * 86_400_000) })
    await expect(service.approveAndSend(draft.id, sha(draft.content))).rejects.toThrow('older than 30 days')
    expect(await ds.getRepository(SendAttempt).count()).toBe(0)
  })
})

describe('processAttempt', () => {
  it('sends once and marks the attempt sent', async () => {
    const draft = await seedDraft()
    const { attemptId } = await service.approveAndSend(draft.id, sha(draft.content))
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('sent')
    expect(attempt.xEventId).toBeTruthy()
    expect(x.sent).toEqual([{ recipientId: '200', text: 'Hi there' }])
  })

  it('never sends text that differs from the approved hash', async () => {
    const draft = await seedDraft()
    const { attemptId } = await service.approveAndSend(draft.id, sha(draft.content))
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
    const { attemptId } = await service.approveAndSend(draft.id, sha(draft.content))
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('failed')
    expect(attempt.error).toContain('X returned 400')
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })).activeAttemptId).toBeNull()
  })

  it('test 8: recipient not accepting DMs -> failed, send right released', async () => {
    const draft = await seedDraft()
    x.nextSend = 'not-accepting'
    const { attemptId } = await service.approveAndSend(draft.id, sha(draft.content))
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('failed')
    expect(attempt.error).toContain("doesn't accept DMs from this account")
    const contact = await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })
    expect(contact.activeAttemptId).toBeNull()
  })
})
