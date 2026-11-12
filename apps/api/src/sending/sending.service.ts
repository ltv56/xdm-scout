import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { DataSource, EntityManager, LessThan } from 'typeorm'
import { JobsService } from '../jobs/jobs.service'
import { DmMessage, SendDmResult, X_CLIENT, XClient, XRateLimitError, XUncertainError } from '../x/x-client'
import { Contact, DoNotContact, Draft, SendAttempt } from './entities'

export const hashContent = (content: string) => createHash('sha256').update(content).digest('hex')

const STALE_SENDING_MS = 60_000
const RECONCILE_EVERY_MS = 60_000
const RECONCILE_GIVE_UP_MS = 10 * 60_000
const INVITATION_MAX_AGE_MS = 30 * 86_400_000
// Reconciliation runs minutes after the attempt, so our message is among the newest few events.
const RECONCILE_READ_MAX = 10

// X allows automated DMs only to people who asked for them, so the API path needs a confirmed, recent invitation.
export function apiSendBlock(contact: Contact, now: Date): string | null {
  if (contact.recipientPermission !== 'requested_dm' || !contact.invitationEventId || !contact.invitationAt) {
    return "API sending is limited to people who messaged you first. This person hasn't."
  }
  if (now.getTime() - contact.invitationAt.getTime() > INVITATION_MAX_AGE_MS) {
    return 'Their invitation is older than 30 days. Send it yourself in X.'
  }
  return null
}

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
      if (draft.status === 'skipped' || draft.status === 'superseded') throw new ConflictException('This draft is no longer in the queue')
      const contact = await em.findOneOrFail(Contact, { where: { id: draft.contactId } })

      if (await em.exists(DoNotContact, { where: { xUserId: contact.xUserId } })) {
        throw new ForbiddenException('Recipient is on Do not contact')
      }
      const blocked = apiSendBlock(contact, new Date())
      if (blocked) throw new ForbiddenException(blocked)
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

    if (hashContent(draft.content) !== attempt.contentHash) {
      return this.release(attempt, contact.id, 'cancelled', 'Draft changed after approval; review it again')
    }
    if (await this.ds.getRepository(DoNotContact).existsBy({ xUserId: contact.xUserId })) {
      return this.release(attempt, contact.id, 'cancelled', 'Recipient is on Do not contact')
    }
    const blocked = apiSendBlock(contact, now)
    if (blocked) return this.release(attempt, contact.id, 'cancelled', blocked)
    let latest: DmMessage | undefined
    try {
      latest = (await this.x.getConversation(contact.xUserId, 1))[0]
    } catch (err) {
      // Nothing was sent yet, so failing here is safe and frees the send right.
      const reason = err instanceof Error ? err.message : String(err)
      return this.release(attempt, contact.id, 'failed', `Could not check the conversation: ${reason}`)
    }
    // A latest message from us that the app did not send means someone already answered by hand.
    if (latest?.fromMe && !(await this.ds.getRepository(SendAttempt).existsBy({ contactId: contact.id, xEventId: latest.eventId }))) {
      return this.release(attempt, contact.id, 'failed', 'Someone already replied outside xdm-scout')
    }

    let sent: SendDmResult
    try {
      sent = await this.x.sendDm(contact.xUserId, draft.content)
    } catch (err) {
      if (err instanceof XRateLimitError) {
        await this.ds.transaction(async (em) => {
          await em.update(SendAttempt, attemptId, { status: 'queued', runAt: err.retryAt })
          await this.jobs.enqueue('send', { attemptId }, err.retryAt, em)
        })
      } else if (err instanceof XUncertainError) {
        await this.markUnknown(attemptId, now)
      } else {
        // Any other X error is a definite refusal: nothing was sent.
        await this.release(attempt, contact.id, 'failed', err instanceof Error ? err.message : String(err))
      }
      return
    }
    // Outside the try: if saving fails after X accepted, the attempt stays `sending` and recovery reconciles it.
    await this.ds
      .getRepository(SendAttempt)
      .update(attemptId, { status: 'sent', xConversationId: sent.conversationId, xEventId: sent.eventId })
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

    const messages = await this.x.getConversation(contact.xUserId, RECONCILE_READ_MAX)
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
