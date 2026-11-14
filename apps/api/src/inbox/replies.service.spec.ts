import 'reflect-metadata'
import { ConflictException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiUsage, Campaign, Prospect } from '../discovery/entities'
import { FakeLlmClient } from '../llm/fake-llm-client'
import { JobsService } from '../jobs/jobs.service'
import { AttemptStatus, Contact, DoNotContact, Draft, SendAttempt } from '../sending/entities'
import { SendingService } from '../sending/sending.service'
import { createTestDataSource } from '../test/db'
import { seedDraft, sha } from '../test/seed'
import { FakeXClient } from '../x/fake-x-client'
import { Reply } from './reply.entity'
import { RepliesService } from './replies.service'

const MIN = 60_000
const HOUR = 60 * MIN

let ds: DataSource
let x: FakeXClient
let replies: RepliesService
let llmAnswer: unknown

async function seedSent(xUserId: string, sentAt: Date, status: AttemptStatus = 'sent') {
  if (!(await ds.getRepository(Campaign).findOneBy({ id: 1 }))) {
    await ds.getRepository(Campaign).save({ id: 1, name: 'c1', keywords: [], handles: [] })
  }
  const draft = await seedDraft(ds, xUserId, `Hi ${xUserId}`)
  const prospect = await ds.getRepository(Prospect).save({ campaignId: 1, xUserId })
  await ds.getRepository(Draft).update(draft.id, { prospectId: prospect.id, status: 'approved', approvedHash: sha(draft.content) })
  const attempt = await ds.getRepository(SendAttempt).save({ contactId: draft.contactId, draftId: draft.id, route: 'api', status, contentHash: sha(draft.content) })
  await ds.query('UPDATE send_attempts SET updatedAt = ? WHERE id = ?', [sentAt, attempt.id])
  await ds.getRepository(Contact).update(draft.contactId, { activeAttemptId: attempt.id })
  return { contactId: draft.contactId, attempt }
}

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  llmAnswer = { class: 'Unclear', probability: 0.5 }
  replies = new RepliesService(ds, x, new JobsService(ds), new FakeLlmClient(() => llmAnswer))
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('due', () => {
  it('reads every 30 min for 6 h, then every 3 h, and stops after 3 days', async () => {
    const t0 = new Date('2026-11-14T00:00:00Z')
    const { contactId } = await seedSent('201', t0)
    const at = (ms: number) => new Date(t0.getTime() + ms)

    expect(await replies.due(at(29 * MIN))).toEqual([])
    expect(await replies.due(at(30 * MIN))).toEqual([contactId])

    await ds.getRepository(Contact).update(contactId, { repliesReadAt: at(5 * HOUR) })
    expect(await replies.due(at(5 * HOUR + 29 * MIN))).toEqual([])
    expect(await replies.due(at(5 * HOUR + 30 * MIN))).toEqual([contactId])

    await ds.getRepository(Contact).update(contactId, { repliesReadAt: at(10 * HOUR) })
    expect(await replies.due(at(12 * HOUR))).toEqual([])
    expect(await replies.due(at(13 * HOUR))).toEqual([contactId])

    expect(await replies.due(at(72 * HOUR))).toEqual([])
  })

  it('skips sends that are not delivered and people who already replied', async () => {
    const t0 = new Date('2026-11-14T00:00:00Z')
    await seedSent('201', t0, 'manual_unverified')
    const { contactId, attempt } = await seedSent('202', t0)
    await ds.getRepository(Reply).save({ contactId, attemptId: attempt.id, source: 'operator', at: t0 })
    expect(await replies.due(new Date(t0.getTime() + HOUR))).toEqual([])
  })
})

describe('scheduleNext', () => {
  it('queues one read per call and never a second read for the same contact', async () => {
    const t0 = new Date('2026-11-14T00:00:00Z')
    const a = await seedSent('201', t0)
    const b = await seedSent('202', t0)
    const now = new Date(t0.getTime() + HOUR)

    await replies.scheduleNext(now)
    await replies.scheduleNext(now)
    await replies.scheduleNext(now)

    const jobs: { type: string; payload: { contactId: number } }[] = await ds.query('SELECT type, payload FROM jobs ORDER BY id')
    expect(jobs.map((j) => [j.type, j.payload.contactId])).toEqual([
      ['read_replies', a.contactId],
      ['read_replies', b.contactId],
    ])
  })
})

describe('markReplied', () => {
  it('stores an operator reply without text, which stops the polling, once', async () => {
    const t0 = new Date('2026-11-14T00:00:00Z')
    const { contactId, attempt } = await seedSent('201', t0)
    await replies.markReplied(attempt.id, new Date(t0.getTime() + HOUR))
    expect(await ds.getRepository(Reply).find()).toEqual([expect.objectContaining({ contactId, attemptId: attempt.id, source: 'operator', text: null, xEventId: null })])
    expect(await replies.due(new Date(t0.getTime() + 2 * HOUR))).toEqual([])
    await expect(replies.markReplied(attempt.id, new Date())).rejects.toBeInstanceOf(ConflictException)
  })

  it('refuses a send that was not delivered', async () => {
    const { attempt } = await seedSent('201', new Date(), 'manual_unverified')
    await expect(replies.markReplied(attempt.id, new Date())).rejects.toBeInstanceOf(ConflictException)
    await expect(replies.markReplied(9999, new Date())).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('checkNow', () => {
  it('queues a read for every chat of the campaign still being polled, and says what it may cost', async () => {
    const t0 = new Date('2026-11-14T00:00:00Z')
    const a = await seedSent('201', t0)
    const b = await seedSent('202', t0)
    await ds.getRepository(Reply).save({ contactId: b.contactId, attemptId: b.attempt.id, source: 'operator', at: t0 })
    await seedSent('203', new Date(t0.getTime() - 4 * 24 * HOUR))
    const now = new Date(t0.getTime() + MIN)

    expect(await replies.checkNow(1, now)).toEqual({ queued: 1, estimatedMicros: 10_000 })
    expect(await replies.checkNow(1, now)).toEqual({ queued: 0, estimatedMicros: 0 })
    const jobs: { payload: { contactId: number } }[] = await ds.query("SELECT payload FROM jobs WHERE type = 'read_replies'")
    expect(jobs.map((j) => j.payload.contactId)).toEqual([a.contactId])
    expect(await replies.checkNow(2, now)).toEqual({ queued: 0, estimatedMicros: 0 })
  })
})

describe('read', () => {
  it('stores nothing when the newest message is ours, and remembers the read', async () => {
    const now = new Date('2026-11-14T01:00:00Z')
    const { contactId } = await seedSent('201', new Date('2026-11-14T00:00:00Z'))
    await x.sendDm('201', 'Hi 201')

    await replies.read(contactId, now)

    expect(x.conversationReads).toEqual([{ recipientId: '201', max: 1 }])
    expect(await ds.getRepository(Reply).count()).toBe(0)
    expect((await ds.getRepository(Contact).findOneByOrFail({ id: contactId })).repliesReadAt).toEqual(now)
  })

  it('stores their newest message as a reply once, which stops the polling', async () => {
    const now = new Date('2026-11-14T01:00:00Z')
    const { contactId, attempt } = await seedSent('201', new Date('2026-11-14T00:00:00Z'))
    const msg = x.priorMessage('201', 'Sounds good, tell me more', new Date('2026-11-14T00:40:00Z'))

    await replies.read(contactId, now)
    await replies.read(contactId, now)

    expect(await ds.getRepository(Reply).find()).toEqual([
      expect.objectContaining({ contactId, attemptId: attempt.id, xEventId: msg.eventId, text: 'Sounds good, tell me more', source: 'api', handledAt: null }),
    ])
    expect(await replies.due(new Date('2026-11-14T05:00:00Z'))).toEqual([])
  })

  it('ignores their messages from before our send', async () => {
    const { contactId } = await seedSent('201', new Date('2026-11-14T00:00:00Z'))
    x.priorMessage('201', 'old message', new Date('2026-11-13T00:00:00Z'))
    await replies.read(contactId, new Date('2026-11-14T01:00:00Z'))
    expect(await ds.getRepository(Reply).count()).toBe(0)
  })

  it('records the estimated cost of each read on the campaign', async () => {
    const { contactId } = await seedSent('201', new Date('2026-11-14T00:00:00Z'))
    await x.sendDm('201', 'Hi 201')
    await replies.read(contactId, new Date('2026-11-14T01:00:00Z'))
    expect(await ds.getRepository(ApiUsage).find()).toEqual([expect.objectContaining({ campaignId: 1, kind: 'dm_event', count: 1, costMicros: 10_000 })])
  })
})

describe('read: reply class', () => {
  async function replyWith(text: string) {
    const { contactId } = await seedSent('201', new Date('2026-11-14T00:00:00Z'))
    x.priorMessage('201', text, new Date('2026-11-14T00:40:00Z'))
    await replies.read(contactId, new Date('2026-11-14T01:00:00Z'))
    return ds.getRepository(Reply).findOneByOrFail({ contactId })
  }

  it('marks a stop request Opt-out by rule, puts them on Do not contact and closes the reply', async () => {
    llmAnswer = { class: 'Interested', probability: 0.99 }
    const reply = await replyWith('Please stop messaging me')
    expect(reply).toMatchObject({ replyClass: 'Opt-out', classBy: 'rule' })
    expect(reply.handledAt).not.toBeNull()
    expect(await ds.getRepository(DoNotContact).find()).toEqual([expect.objectContaining({ xUserId: '201', source: 'reply', reason: 'Replied: Opt-out' })])
  })

  it('keeps an Interested reply open and off the list', async () => {
    llmAnswer = { class: 'Interested', probability: 0.9 }
    const reply = await replyWith('Would love to talk')
    expect(reply).toMatchObject({ replyClass: 'Interested', classBy: 'llm', handledAt: null })
    expect(await ds.getRepository(DoNotContact).count()).toBe(0)
  })

  it('puts Not interested on the list and only records Not now', async () => {
    llmAnswer = { class: 'Not interested', probability: 0.9 }
    expect((await replyWith('Not for me, thanks')).handledAt).not.toBeNull()
    expect(await ds.getRepository(DoNotContact).findOneBy({ xUserId: '201' })).toMatchObject({ reason: 'Replied: Not interested' })

    llmAnswer = { class: 'Not now', probability: 0.9 }
    const { contactId } = await seedSent('202', new Date('2026-11-14T00:00:00Z'))
    x.priorMessage('202', 'Maybe next quarter', new Date('2026-11-14T00:40:00Z'))
    await replies.read(contactId, new Date('2026-11-14T01:00:00Z'))
    expect((await ds.getRepository(Reply).findOneByOrFail({ contactId })).handledAt).not.toBeNull()
    expect(await ds.getRepository(DoNotContact).existsBy({ xUserId: '202' })).toBe(false)
  })
})

describe('worker', () => {
  it('runs read_replies jobs and retries them when X rate-limits', async () => {
    const { Worker } = await import('../sending/worker')
    const { XRateLimitError } = await import('../x/x-client')
    const jobs = new JobsService(ds)
    const sending = new SendingService(ds, x, jobs)
    const worker = new Worker(jobs, sending, undefined as never, undefined as never, undefined as never, replies)
    const { contactId } = await seedSent('201', new Date('2026-11-14T00:00:00Z'))
    const retryAt = new Date('2026-11-14T02:00:00.000Z')
    x.conversationError = new XRateLimitError(retryAt)

    await jobs.enqueue('read_replies', { contactId }, new Date('2026-11-14T01:00:00Z'))
    await worker.tick(new Date('2026-11-14T01:00:00Z'))

    const [{ status, runAt }] = await ds.query('SELECT status, runAt FROM jobs')
    expect(status).toBe('pending')
    expect(new Date(runAt)).toEqual(retryAt)
  })
})
