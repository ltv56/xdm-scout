import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Job } from '../jobs/job.entity'
import { JobsService } from '../jobs/jobs.service'
import { createTestDataSource } from '../test/db'
import { seedDraft, sha } from '../test/seed'
import { FakeXClient } from '../x/fake-x-client'
import { Contact, DoNotContact, SendAttempt } from './entities'
import { SendingService } from './sending.service'
import { Worker } from './worker'

let ds: DataSource
let x: FakeXClient
let service: SendingService
let worker: Worker

const t0 = new Date('2026-11-12T10:00:00Z')
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms)
const MIN = 60_000

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  const jobs = new JobsService(ds)
  service = new SendingService(ds, x, jobs)
  worker = new Worker(jobs, service)
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

async function approve(content = 'Hi there') {
  const draft = await seedDraft(ds, '200', content)
  const { attemptId } = await service.approveAndSend(draft.id, sha(content))
  return { draft, attemptId }
}

const attemptOf = (id: number) => ds.getRepository(SendAttempt).findOneByOrFail({ id })
const contactOf = (id: number) => ds.getRepository(Contact).findOneByOrFail({ id })

describe('worker', () => {
  it('approve enqueues a job and a tick sends the DM once', async () => {
    const { attemptId } = await approve()
    expect(await worker.tick(new Date())).toBe(true)
    expect((await attemptOf(attemptId)).status).toBe('sent')
    expect(x.sent).toHaveLength(1)
    expect(await worker.tick(new Date())).toBe(false)
  })

  it('two workers racing on one job send one DM', async () => {
    await approve()
    const other = new Worker(new JobsService(ds), service)
    await Promise.all([worker.tick(new Date()), other.tick(new Date())])
    expect(x.sent).toHaveLength(1)
  })

  it('marks finished jobs done', async () => {
    await approve()
    await worker.tick(new Date())
    expect(await ds.getRepository(Job).countBy({ status: 'done' })).toBe(1)
  })
})

describe('send outcomes', () => {
  it('test 4: timeout but delivered -> unknown, reconcile finds it, no resend', async () => {
    const { attemptId } = await approve()
    x.nextSend = 'timeout-delivered'
    await worker.tick(new Date())
    expect((await attemptOf(attemptId)).status).toBe('unknown')

    await worker.tick(new Date(Date.now() + MIN))
    const attempt = await attemptOf(attemptId)
    expect(attempt.status).toBe('sent')
    expect(attempt.xEventId).toBeTruthy()
    expect(x.sendCalls).toBe(1)
  })

  it('test 5: timeout and not delivered -> unknown, then needs_decision after 10 min', async () => {
    const { attemptId } = await approve()
    x.nextSend = 'timeout-undelivered'
    await worker.tick(new Date())

    await worker.tick(new Date(Date.now() + 2 * MIN))
    expect((await attemptOf(attemptId)).status).toBe('unknown')

    await service.reconcile(attemptId, new Date(Date.now() + 11 * MIN))
    const attempt = await attemptOf(attemptId)
    expect(attempt.status).toBe('needs_decision')
    expect((await contactOf(attempt.contactId)).activeAttemptId).toBe(attemptId)
    expect(x.sendCalls).toBe(1)
  })

  it('test 6: stale sending on startup -> unknown -> reconciled to sent', async () => {
    const { attemptId } = await approve()
    await ds.getRepository(SendAttempt).update(attemptId, { status: 'sending', updatedAt: t0 })
    x.deliverSilently('200', 'Hi there', plus(t0, 1000))

    await service.recoverStale(plus(t0, 2 * MIN))
    expect((await attemptOf(attemptId)).status).toBe('unknown')

    await service.reconcile(attemptId, plus(t0, 3 * MIN))
    expect((await attemptOf(attemptId)).status).toBe('sent')
    expect(x.sendCalls).toBe(0)
  })

  it('test 6c: X timestamps are whole seconds, a message from the same second still matches', async () => {
    const { attemptId } = await approve()
    await ds.getRepository(SendAttempt).update(attemptId, {
      status: 'sending',
      updatedAt: t0,
      createdAt: plus(t0, 700),
    })
    x.deliverSilently('200', 'Hi there', t0)
    await service.recoverStale(plus(t0, 2 * MIN))
    await service.reconcile(attemptId, plus(t0, 3 * MIN))
    expect((await attemptOf(attemptId)).status).toBe('sent')
  })

  it('test 6b: sending newer than 60 s is left alone', async () => {
    const { attemptId } = await approve()
    await ds.getRepository(SendAttempt).update(attemptId, { status: 'sending', updatedAt: t0 })
    await service.recoverStale(plus(t0, 30_000))
    expect((await attemptOf(attemptId)).status).toBe('sending')
  })

  it('test 7: existing conversation -> no send, attempt stopped, right released', async () => {
    const { attemptId } = await approve()
    x.priorMessage('200', 'hey from before')
    await worker.tick(new Date())
    const attempt = await attemptOf(attemptId)
    expect(attempt.status).toBe('failed')
    expect(attempt.error).toContain('existing conversation')
    expect(x.sendCalls).toBe(0)
    expect((await contactOf(attempt.contactId)).activeAttemptId).toBeNull()
  })

  it('test 9: rate limit -> back to queued with a retry time, still holds the right', async () => {
    const { attemptId } = await approve()
    const retryAt = new Date(Date.now() + 15 * MIN)
    x.nextSend = 'rate-limit'
    x.retryAt = retryAt
    await worker.tick(new Date())

    const attempt = await attemptOf(attemptId)
    expect(attempt.status).toBe('queued')
    expect(attempt.runAt?.getTime()).toBe(retryAt.getTime())
    expect((await contactOf(attempt.contactId)).activeAttemptId).toBe(attemptId)
    expect(await worker.tick(new Date())).toBe(false)

    x.nextSend = 'ok'
    expect(await worker.tick(plus(retryAt, 1000))).toBe(true)
    expect((await attemptOf(attemptId)).status).toBe('sent')
  })

  it('test 15: cannot read the conversation (revoked token) -> failed, nothing sent, right released', async () => {
    const { attemptId } = await approve()
    x.conversationError = new Error('token revoked')
    await worker.tick(new Date())
    const attempt = await attemptOf(attemptId)
    expect(attempt.status).toBe('failed')
    expect(attempt.error).toContain('token revoked')
    expect(x.sendCalls).toBe(0)
    expect((await contactOf(attempt.contactId)).activeAttemptId).toBeNull()
  })

  it('test 10: Do not contact added after approve blocks the send', async () => {
    const { attemptId } = await approve()
    await ds.getRepository(DoNotContact).save({ xUserId: '200', reason: 'asked to stop', source: 'test' })
    await worker.tick(new Date())
    const attempt = await attemptOf(attemptId)
    expect(attempt.status).toBe('cancelled')
    expect(x.sendCalls).toBe(0)
    expect((await contactOf(attempt.contactId)).activeAttemptId).toBeNull()
  })
})
