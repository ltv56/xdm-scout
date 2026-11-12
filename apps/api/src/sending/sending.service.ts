import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { DataSource } from 'typeorm'
import { X_CLIENT, XClient, XNotAcceptingDmError } from '../x/x-client'
import { Contact, DoNotContact, Draft, SendAttempt } from './entities'

export const hashContent = (content: string) => createHash('sha256').update(content).digest('hex')

@Injectable()
export class SendingService {
  constructor(
    private readonly ds: DataSource,
    @Inject(X_CLIENT) private readonly x: XClient,
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
      return { attemptId: attempt.id }
    })
  }

  async processAttempt(attemptId: number): Promise<void> {
    const taken = await this.ds
      .getRepository(SendAttempt)
      .update({ id: attemptId, status: 'queued' }, { status: 'sending' })
    if (taken.affected !== 1) return

    const attempt = await this.ds.getRepository(SendAttempt).findOneByOrFail({ id: attemptId })
    const draft = await this.ds.getRepository(Draft).findOneByOrFail({ id: attempt.draftId })
    const contact = await this.ds.getRepository(Contact).findOneByOrFail({ id: attempt.contactId })

    try {
      const sent = await this.x.sendDm(contact.xUserId, draft.content)
      await this.ds
        .getRepository(SendAttempt)
        .update(attemptId, { status: 'sent', xConversationId: sent.conversationId, xEventId: sent.eventId })
    } catch (err) {
      if (!(err instanceof XNotAcceptingDmError)) throw err
      await this.ds.transaction(async (em) => {
        await em.update(SendAttempt, attemptId, { status: 'failed', error: err.message })
        await em.update(Contact, contact.id, { activeAttemptId: null })
      })
    }
  }
}
