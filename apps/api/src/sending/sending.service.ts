import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { DataSource, EntityManager, LessThan } from 'typeorm'
import { JobsService } from '../jobs/jobs.service'
import { X_CLIENT, XClient, XNotAcceptingDmError, XRateLimitError, XUncertainError } from '../x/x-client'
import { Contact, DoNotContact, Draft, SendAttempt } from './entities'

export const hashContent = (content: string) => createHash('sha256').update(content).digest('hex')

const STALE_SENDING_MS = 60_000
const RECONCILE_EVERY_MS = 60_000
const RECONCILE_GIVE_UP_MS = 10 * 60_000

@Injectable()
export class SendingService {
  constructor(
    private readonly ds: DataSource,
    @Inject(X_CLIENT) private readonly x: XClient,
    private readonly jobs: JobsService,
  ) {}

  async approveAndSend(draftId: number, seenHash: string): Promise<{ attemptId: number }> {
    return this.ds.transaction(async (em) => {
      const draft = await em.findOne(Draft, { where: { id: draftId } })
      if (!draft) throw new NotFoundException('Draft not found')
      const contact = await em.findOneOrFail(Contact, { where: { id: draft.contactId } })

      if (await em.exists(DoNotContact, { where: { xUserId: contact.xUserId } })) {
        throw new ForbiddenException('Recipient is on Do not contact')
      }
      const contentHash = hashContent(draft.content)
      if (contentHash !== seenHash) throw new ConflictException('Draft changed after you reviewed it')

      const attempt = await em.save(SendAttempt, { contactId: contact.id, draftId, contentHash })
      const claim = await em
        .createQueryBuilder()
        .update(Contact)
        .set({ activeAttemptId: attempt.id })
        .where('id = :id AND activeAttemptId IS NULL', { id: contact.id })
        .execute()
      if (claim.affected !== 1) throw new ConflictException('Already queued')

      await em.update(Draft, draftId, { status: 'approved', approvedHash: contentHash })
      await this.jobs.enqueue('send', { attemptId: attempt.id }, new Date(), em)
      return { attemptId: attempt.id }
    })
  }

  async processAttempt(attemptId: number, now = new Date()): Promise<void> {
    const taken = await this.ds
      .getRepository(SendAttempt)
      .update({ id: attemptId, status: 'queued' }, { status: 'sending' })
    if (taken.affected !== 1) return

    const attempt = await this.ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    const draft = await this.ds.getRepository(Draft).findOneByOrFail({ id: attempt.draftId })
    const contact = await this.ds.getRepository(Contact).findOneByOrFail({ id: attempt.contactId })

    if (await this.ds.getRepository(DoNotContact).existsBy({ xUserId: contact.xUserId })) {
      return this.release(attempt, contact.id, 'cancelled', 'Recipient is on Do not contact')
    }
    let existing: number
    try {
      existing = (await this.x.getConversation(contact.xUserId)).length
    } catch (err) {
      // Nothing was sent yet, so failing here is safe and frees the send right.
      const reason = err instanceof Error ? err.message : String(err)
      return this.release(attempt, contact.id, 'failed', `Could not check the conversation: ${reason}`)
    }
    if (existing > 0) {
      return this.release(attempt, contact.id, 'failed', 'An existing conversation was found, not sending')
    }

    try {
      const sent = await this.x.sendDm(contact.xUserId, draft.content)
      await this.ds
        .getRepository(SendAttempt)
        .update(attemptId, { status: 'sent', xConversationId: sent.conversationId, xEventId: sent.eventId })
    } catch (err) {
      if (err instanceof XNotAcceptingDmError) {
        await this.release(attempt, contact.id, 'failed', err.message)
      } else if (err instanceof XRateLimitError) {
        await this.ds.transaction(async (em) => {
          await em.update(SendAttempt, attemptId, { status: 'queued', runAt: err.retryAt })
          await this.jobs.enqueue('send', { attemptId }, err.retryAt, em)
        })
      } else if (err instanceof XUncertainError) {
        await this.markUnknown(attemptId, now)
      } else {
        throw err
      }
    }
  }

  async recoverStale(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - STALE_SENDING_MS)
    const stale = await this.ds.getRepository(SendAttempt).findBy({ status: 'sending', updatedAt: LessThan(cutoff) })
    for (const attempt of stale) await this.markUnknown(attempt.id, now)
  }

  async reconcile(attemptId: number, now: Date): Promise<void> {
    const attempt = await this.ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    if (attempt.status !== 'unknown') return
    const draft = await this.ds.getRepository(Draft).findOneByOrFail({ id: attempt.draftId })
    const contact = await this.ds.getRepository(Contact).findOneByOrFail({ id: attempt.contactId })

    const messages = await this.x.getConversation(contact.xUserId)
    // X timestamps have whole-second precision, so compare from the start of the attempt's second.
    const since = Math.floor(attempt.createdAt.getTime() / 1000) * 1000
    const found = messages.find((m) => m.fromMe && m.text === draft.content && m.createdAt.getTime() >= since)
    if (found) {
      await this.ds
        .getRepository(SendAttempt)
        .update(attemptId, { status: 'sent', xConversationId: found.conversationId, xEventId: found.eventId })
      return
    }
    const waited = now.getTime() - (attempt.unknownAt ?? now).getTime()
    if (waited >= RECONCILE_GIVE_UP_MS) {
      await this.ds.getRepository(SendAttempt).update(attemptId, { status: 'needs_decision' })
      return
    }
    await this.jobs.enqueue('reconcile', { attemptId }, new Date(now.getTime() + RECONCILE_EVERY_MS))
  }

  private async markUnknown(attemptId: number, now: Date) {
    await this.ds.transaction(async (em) => {
      await em.update(SendAttempt, attemptId, { status: 'unknown', unknownAt: now })
      await this.jobs.enqueue('reconcile', { attemptId }, new Date(now.getTime() + RECONCILE_EVERY_MS), em)
    })
  }

  private release(attempt: SendAttempt, contactId: number, status: 'failed' | 'cancelled', error: string) {
    return this.ds.transaction(async (em: EntityManager) => {
      await em.update(SendAttempt, attempt.id, { status, error })
      await em.update(Contact, contactId, { activeAttemptId: null })
    })
  }
}
