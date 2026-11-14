import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { ApiUsage, Prospect } from '../discovery/entities'
import { PRICES } from '../discovery/pricing'
import { JobsService } from '../jobs/jobs.service'
import { Contact, Draft, SendAttempt } from '../sending/entities'
import { X_CLIENT, XClient } from '../x/x-client'
import { Reply } from './reply.entity'

const MIN = 60_000
const HOUR = 60 * MIN
// Each read costs money, so poll often only while a reply is most likely.
const FAST_FOR = 6 * HOUR
const FAST_EVERY = 30 * MIN
const SLOW_EVERY = 3 * HOUR
const STOP_AFTER = 72 * HOUR

type Polled = { contactId: number; attemptId: number; xUserId: string; campaignId: number; sentAt: Date; readAt: Date | null }

@Injectable()
export class RepliesService {
  constructor(
    private readonly ds: DataSource,
    @Inject(X_CLIENT) private readonly x: XClient,
    private readonly jobs: JobsService,
  ) {}

  async due(now: Date): Promise<number[]> {
    return (await this.polled())
      .filter((p) => isDue(p, now))
      .sort((a, b) => lastRead(a) - lastRead(b) || a.contactId - b.contactId)
      .map((p) => p.contactId)
  }

  // One read per call; the worker calls this once a minute to stay under X's 15 DM reads per 15 minutes.
  async scheduleNext(now: Date): Promise<void> {
    for (const contactId of await this.due(now)) {
      if (await this.jobs.hasOpen('read_replies', 'contactId', contactId)) continue
      await this.jobs.enqueue('read_replies', { contactId }, now)
      return
    }
  }

  // Reads every chat of the campaign still being polled, now instead of at its next turn.
  async checkNow(campaignId: number, now: Date): Promise<{ queued: number; estimatedMicros: number }> {
    let queued = 0
    for (const p of await this.polled()) {
      if (p.campaignId !== campaignId || now.getTime() - p.sentAt.getTime() >= STOP_AFTER) continue
      if (await this.jobs.hasOpen('read_replies', 'contactId', p.contactId)) continue
      await this.jobs.enqueue('read_replies', { contactId: p.contactId }, now)
      queued += 1
    }
    return { queued, estimatedMicros: queued * PRICES.dm_event }
  }

  // They replied in an encrypted chat the API can't read; the operator saw it in X.
  async markReplied(attemptId: number, now: Date): Promise<void> {
    await this.ds.transaction(async (em) => {
      const attempt = await em.findOne(SendAttempt, { where: { id: attemptId, status: 'sent' }, lock: { mode: 'pessimistic_write' } })
      if (!attempt) throw new ConflictException('This message was not delivered')
      if (await em.existsBy(Reply, { contactId: attempt.contactId })) throw new ConflictException('A reply is already recorded')
      await em.save(Reply, { contactId: attempt.contactId, attemptId, source: 'operator', at: now })
    })
  }

  async read(contactId: number, now: Date): Promise<void> {
    const p = (await this.polled()).find((row) => row.contactId === contactId)
    if (!p) return
    const [newest] = await this.x.getConversation(p.xUserId, 1)
    if (newest) await this.ds.getRepository(ApiUsage).save({ campaignId: p.campaignId, kind: 'dm_event', count: 1, costMicros: PRICES.dm_event })
    if (newest && !newest.fromMe && newest.createdAt >= p.sentAt) {
      await this.ds
        .createQueryBuilder()
        .insert()
        .into(Reply)
        .values({ contactId, attemptId: p.attemptId, xEventId: newest.eventId, text: newest.text, source: 'api', at: newest.createdAt })
        .orIgnore()
        .execute()
    }
    await this.ds.getRepository(Contact).update(contactId, { repliesReadAt: now })
  }

  // Delivered sends whose contact has no reply yet, newest send per contact.
  private async polled(): Promise<Polled[]> {
    const rows = await this.ds
      .createQueryBuilder(SendAttempt, 'a')
      .innerJoin(Contact, 'c', 'c.id = a.contactId')
      .innerJoin(Draft, 'd', 'd.id = a.draftId')
      .innerJoin(Prospect, 'p', 'p.id = d.prospectId')
      .leftJoin(Reply, 'r', 'r.contactId = c.id')
      .where("a.status = 'sent' AND r.id IS NULL")
      .select(['c.id AS contactId', 'a.id AS attemptId', 'c.xUserId AS xUserId', 'p.campaignId AS campaignId', 'a.updatedAt AS sentAt', 'c.repliesReadAt AS readAt'])
      .orderBy('a.id', 'DESC')
      .getRawMany<Polled>()
    const byContact = new Map<number, Polled>()
    for (const r of rows) {
      const contactId = Number(r.contactId)
      if (!byContact.has(contactId)) {
        byContact.set(contactId, { ...r, contactId, attemptId: Number(r.attemptId), campaignId: Number(r.campaignId), sentAt: new Date(r.sentAt), readAt: r.readAt && new Date(r.readAt) })
      }
    }
    return [...byContact.values()]
  }
}

const lastRead = (p: Polled) => Math.max(p.sentAt.getTime(), p.readAt?.getTime() ?? 0)

function isDue(p: Polled, now: Date): boolean {
  const age = now.getTime() - p.sentAt.getTime()
  if (age >= STOP_AFTER) return false
  const last = lastRead(p)
  const every = last - p.sentAt.getTime() < FAST_FOR ? FAST_EVERY : SLOW_EVERY
  return now.getTime() - last >= every
}
