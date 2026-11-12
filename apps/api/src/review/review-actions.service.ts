import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Contact, Draft, SendAttempt } from '../sending/entities'
import { hashContent, SendingService } from '../sending/sending.service'
import { StoredSentence } from './checks'
import { ApproveBody, ReviewItem } from './contract'
import { ReviewService } from './review.service'

const OPT_OUT = /no worries|no pressure|not interested|ignore this|feel free to ignore|no reply needed/i
const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean)

// Attempts the reviewer can still pull back; once the worker is sending or unsure, the draft is out of their hands.
const PULLABLE: SendAttempt['status'][] = ['queued', 'manual_pending']

@Injectable()
export class ReviewActionsService {
  constructor(
    private readonly ds: DataSource,
    private readonly review: ReviewService,
    private readonly sending: SendingService,
  ) {}

  async edit(draftId: number, text: string, now = new Date()): Promise<ReviewItem> {
    await this.ds.transaction(async (em) => {
      const draft = await em.findOne(Draft, { where: { id: draftId } })
      if (!draft || (draft.status !== 'pending' && draft.status !== 'approved')) throw new ConflictException('This draft is no longer in the queue')

      const attempts = await em.findBy(SendAttempt, { draftId })
      if (attempts.some((a) => !PULLABLE.includes(a.status) && !['cancelled', 'failed'].includes(a.status))) {
        throw new ConflictException('This draft is already being sent')
      }
      for (const attempt of attempts.filter((a) => PULLABLE.includes(a.status))) {
        await em.update(SendAttempt, attempt.id, { status: 'cancelled', error: 'Draft edited after approval' })
        await em.update(Contact, { id: attempt.contactId, activeAttemptId: attempt.id }, { activeAttemptId: null })
      }

      const known = new Map((draft.sentences ?? []).map((s) => [s.text, s.source]))
      const sentences: StoredSentence[] = splitSentences(text.trim()).map((t) => ({ text: t, source: known.get(t) ?? (OPT_OUT.test(t) ? { type: 'opt_out' } : null) }))
      await em.update(Draft, draftId, { sentences, content: sentences.map((s) => s.text).join(' '), status: 'pending', approvedHash: null, editedByReviewer: true })
    })
    return this.review.one(draftId, now)
  }

  async approve(draftId: number, body: ApproveBody, now = new Date()) {
    const draft = await this.ds.getRepository(Draft).findOneBy({ id: draftId })
    if (!draft) return this.sending.approveAndSend(draftId, body.contentHash)
    if (draft.status !== 'pending') throw new ConflictException('This draft is no longer in the queue')
    if (hashContent(draft.content) !== body.contentHash) throw new ConflictException('The draft changed since you read it. Review it again.')

    if (draft.sentences) {
      const { checks } = await this.review.one(draftId, now)
      if (checks.some((c) => c.level === 'block')) throw new ConflictException('Fix the blocking checks first')
      if (checks.some((c) => c.needsConfirm) && !body.confirmedUnbacked) throw new ConflictException('Confirm the sentences you added')
    }
    return draft.sendPath === 'API_SEND' ? this.sending.approveAndSend(draftId, body.contentHash) : this.sending.approveManual(draftId, body.contentHash)
  }
}
