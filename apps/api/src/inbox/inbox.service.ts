import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource, In, IsNull } from 'typeorm'
import { Prospect } from '../discovery/entities'
import { AttemptStatus, Contact, Draft, SendAttempt, XUser } from '../sending/entities'
import { CheckItem, ConfirmBody, DeliveredItem, InboxChecks, ReplyItem } from './contract'
import { Reply } from './reply.entity'

const TO_CHECK: AttemptStatus[] = ['manual_unverified', 'needs_decision']

type Row = { id: number; status: AttemptStatus; verifiedBy: 'api' | 'operator' | null; at: Date; xUserId: string; handle: string | null; name: string | null; text: string; replied: number | string }
type ReplyRow = { replyId: number; theirText: string | null; at: Date; handledAt: Date | null; xUserId: string; handle: string | null; name: string | null; ourText: string }

const openInX = (xUserId: string) => `https://x.com/messages/compose?recipient_id=${xUserId}`

@Injectable()
export class InboxService {
  constructor(private readonly ds: DataSource) {}

  async checks(campaignId: number): Promise<InboxChecks> {
    const rows = await this.ds
      .createQueryBuilder(SendAttempt, 'a')
      .innerJoin(Draft, 'd', 'd.id = a.draftId')
      .innerJoin(Prospect, 'p', 'p.id = d.prospectId AND p.campaignId = :campaignId', { campaignId })
      .innerJoin(Contact, 'c', 'c.id = a.contactId')
      .leftJoin(XUser, 'u', 'u.xUserId = c.xUserId')
      .where('a.status IN (:...statuses)', { statuses: [...TO_CHECK, 'sent'] })
      .select(['a.id AS id', 'a.status AS status', 'a.verifiedBy AS verifiedBy', 'a.updatedAt AS at', 'c.xUserId AS xUserId', 'u.handle AS handle', 'u.name AS name', 'd.content AS text'])
      .addSelect('EXISTS (SELECT 1 FROM replies r WHERE r.contactId = c.id)', 'replied')
      .orderBy('a.id', 'ASC')
      .getRawMany<Row>()
    const toCheck: CheckItem[] = rows
      .filter((r) => TO_CHECK.includes(r.status))
      .map((r) => ({
        ...person(r),
        reason: r.status === 'manual_unverified' ? 'sent_by_hand' : 'not_confirmed',
        openInX: openInX(r.xUserId),
      }))
    const delivered: DeliveredItem[] = rows
      .filter((r) => r.status === 'sent')
      .reverse()
      .map((r) => ({ ...person(r), verifiedBy: r.verifiedBy ?? 'api', replied: Number(r.replied) === 1 }))
    return { replies: await this.replies(campaignId), toCheck, delivered }
  }

  async markHandled(replyId: number): Promise<void> {
    const res = await this.ds.getRepository(Reply).update({ id: replyId, handledAt: IsNull() }, { handledAt: new Date() })
    if (!res.affected) throw new ConflictException('This reply is not waiting to be handled')
  }

  // The operator looked at the chat in X. Encrypted chats hide hand-sent messages from the API, so their word decides.
  async confirm(attemptId: number, outcome: ConfirmBody['outcome']): Promise<void> {
    await this.ds.transaction(async (em) => {
      const attempt = await em.findOne(SendAttempt, { where: { id: attemptId, status: In(TO_CHECK) }, lock: { mode: 'pessimistic_write' } })
      if (!attempt) throw new ConflictException('This send is not waiting for a check')
      if (outcome === 'sent') {
        await em.update(SendAttempt, attempt.id, { status: 'sent', verifiedBy: 'operator' })
        return
      }
      await em.update(SendAttempt, attempt.id, { status: 'cancelled', error: 'Operator checked X: not sent' })
      await em.update(Contact, { id: attempt.contactId, activeAttemptId: attempt.id }, { activeAttemptId: null })
      await em.update(Draft, attempt.draftId, { status: 'pending', approvedHash: null })
    })
  }

  private async replies(campaignId: number): Promise<ReplyItem[]> {
    const rows = await this.ds
      .createQueryBuilder(Reply, 'r')
      .innerJoin(SendAttempt, 'a', 'a.id = r.attemptId')
      .innerJoin(Draft, 'd', 'd.id = a.draftId')
      .innerJoin(Prospect, 'p', 'p.id = d.prospectId AND p.campaignId = :campaignId', { campaignId })
      .innerJoin(Contact, 'c', 'c.id = r.contactId')
      .leftJoin(XUser, 'u', 'u.xUserId = c.xUserId')
      .select(['r.id AS replyId', 'r.text AS theirText', 'r.at AS at', 'r.handledAt AS handledAt', 'c.xUserId AS xUserId', 'u.handle AS handle', 'u.name AS name', 'd.content AS ourText'])
      .orderBy('r.at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .getRawMany<ReplyRow>()
    return rows.map((r) => ({
      replyId: Number(r.replyId),
      handle: r.handle ?? r.xUserId,
      name: r.name,
      theirText: r.theirText,
      ourText: r.ourText,
      at: new Date(r.at).toISOString(),
      handled: r.handledAt !== null,
      openInX: openInX(r.xUserId),
    }))
  }
}

const person = (r: Row) => ({ attemptId: Number(r.id), handle: r.handle ?? r.xUserId, name: r.name, text: r.text, at: new Date(r.at).toISOString() })
