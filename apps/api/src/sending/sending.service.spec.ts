import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDataSource } from '../test/db'
import { FakeXClient } from '../x/fake-x-client'
import { Contact, Draft, DoNotContact, SendAttempt, SenderAccount, XUser } from './entities'
import { SendingService } from './sending.service'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

let ds: DataSource
let x: FakeXClient
let service: SendingService

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  service = new SendingService(ds, x)
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

async function seedDraft(xUserId = '200', content = 'Hi there') {
  await ds.getRepository(SenderAccount).save({ id: 1, xUserId: '100', handle: 'a' })
  await ds.getRepository(XUser).save({ xUserId, handle: `u${xUserId}` })
  const contact = await ds.getRepository(Contact).save({
    senderAccountId: 1,
    xUserId,
    recipientPermission: 'requested_dm',
  })
  return ds.getRepository(Draft).save({ contactId: contact.id, content })
}

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

  it('test 8: recipient not accepting DMs -> failed, send right released', async () => {
    const draft = await seedDraft()
    x.nextSend = 'not-accepting'
    const { attemptId } = await service.approveAndSend(draft.id, sha(draft.content))
    await service.processAttempt(attemptId)
    const attempt = await ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    expect(attempt.status).toBe('failed')
    expect(attempt.error).toContain('not accepting')
    const contact = await ds.getRepository(Contact).findOneByOrFail({ id: draft.contactId })
    expect(contact.activeAttemptId).toBeNull()
  })
})
