import { ConflictException, Injectable } from '@nestjs/common'
import { DataSource, EntityManager, In } from 'typeorm'
import { Contact, DoNotContact, Draft, SendAttempt } from '../sending/entities'
import { hashContent, SendingService } from '../sending/sending.service'
import { JobsService } from '../jobs/jobs.service'
import { StoredSentence } from './checks'
import { ApproveBody, ReviewItem, SkipBody } from './contract'
import { DraftService } from './draft.service'
import { ReviewSignal, SignalAction } from './review-signal.entity'
import { ReviewService } from './review.service'

const OPT_OUT = /no worries|no pressure|not interested|ignore this|feel free to ignore|no reply needed/i
const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean)

// Attempts the reviewer can still pull back; once the worker is sending or unsure, the draft is out of their hands.
const PULLABLE: SendAttempt['status'][] = ['queued', 'manual_pending']
const SETTLED: SendAttempt['status'][] = ['cancelled', 'failed']

@Injectable()
export class ReviewActionsService {
  constructor(
    private readonly ds: DataSource,
    private readonly review: ReviewService,
    private readonly sending: SendingService,
    private readonly drafts: DraftService,
    private readonly jobs: JobsService,
  ) {}

  async edit(draftId: number, text: string, now = new Date()): Promise<ReviewItem> {
    await this.ds.transaction(async (em) => {
      const draft = await this.live(em, draftId)
      await this.pullBack(em, draftId)
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
    const result = draft.sendPath === 'API_SEND' ? await this.sending.approveAndSend(draftId, body.contentHash) : await this.sending.approveManual(draftId, body.contentHash)
    await this.signal('approve', draft, { finalText: draft.content })
    return result
  }

  async skip(draftId: number, body: SkipBody, now = new Date()): Promise<ReviewItem> {
    const draft = await this.ds.transaction(async (em) => {
      const d = await this.live(em, draftId)
      await this.pullBack(em, draftId)
      await em.update(Draft, draftId, { status: 'skipped', approvedHash: null })
      return d
    })
    await this.signal('skip', draft, { reason: body.reason, note: body.note ?? null })
    return this.review.one(draftId, now)
  }

  // The new draft is written first, so a model failure leaves the old one untouched.
  async regenerate(draftId: number, note: string, now = new Date()): Promise<ReviewItem> {
    const old = await this.ds.transaction(async (em) => {
      const d = await this.live(em, draftId)
      await this.assertPullable(em, draftId)
      return d
    })
    const newId = await this.drafts.generate(old.prospectId!, now, note)
    await this.ds.transaction(async (em) => {
      await this.pullBack(em, draftId)
      await em.update(Draft, draftId, { status: 'superseded', approvedHash: null })
    })
    await this.signal('regenerate', old, { note })
    return this.review.one(newId, now)
  }

  async doNotContact(draftId: number) {
    const draft = await this.ds.getRepository(Draft).findOneByOrFail({ id: draftId })
    await this.ds.transaction(async (em) => {
      const contact = await em.findOneByOrFail(Contact, { id: draft.contactId })
      const open = await em.findBy(Draft, { contactId: contact.id, status: In(['pending', 'approved']) })
      for (const d of open) await this.pullBack(em, d.id)
      await em.update(Draft, { contactId: contact.id, status: In(['pending', 'approved']) }, { status: 'skipped', approvedHash: null })
      await em.save(DoNotContact, { xUserId: contact.xUserId, reason: 'Reviewer chose Do not contact', source: 'review' })
    })
    await this.signal('dnc', draft, {})
    return { ok: true }
  }

  async manual(draftId: number, outcome: 'sent' | 'not_sent', now = new Date()): Promise<ReviewItem> {
    await this.ds.transaction(async (em) => {
      const draft = await em.findOne(Draft, { where: { id: draftId } })
      if (!draft || draft.sendPath !== 'HUMAN_HANDOFF' || draft.status !== 'approved') throw new ConflictException('Approve a draft you send yourself first')
      const attempt = await em.findOne(SendAttempt, { where: { draftId, route: 'manual', status: 'manual_pending' } })
      if (!attempt) throw new ConflictException('Already recorded')
      if (outcome === 'sent') {
        await em.update(SendAttempt, attempt.id, { status: 'manual_unverified' })
        await this.jobs.enqueue('verify_manual', { attemptId: attempt.id }, now, em)
      } else {
        await em.update(SendAttempt, attempt.id, { status: 'cancelled', error: 'Reviewer did not send it' })
        await em.update(Contact, { id: attempt.contactId, activeAttemptId: attempt.id }, { activeAttemptId: null })
        await em.update(Draft, draftId, { status: 'pending', approvedHash: null })
      }
    })
    const item = await this.review.one(draftId, now)
    return outcome === 'not_sent' ? { ...item, status: 'not_sent' } : item
  }

  private async live(em: EntityManager, draftId: number) {
    const draft = await em.findOne(Draft, { where: { id: draftId } })
    if (!draft || (draft.status !== 'pending' && draft.status !== 'approved')) throw new ConflictException('This draft is no longer in the queue')
    return draft
  }

  private async assertPullable(em: EntityManager, draftId: number) {
    const attempts = await em.findBy(SendAttempt, { draftId })
    if (attempts.some((a) => !PULLABLE.includes(a.status) && !SETTLED.includes(a.status))) throw new ConflictException('This draft is already being sent')
    return attempts.filter((a) => PULLABLE.includes(a.status))
  }

  // Cancels the draft's open attempts and gives the send right back.
  private async pullBack(em: EntityManager, draftId: number) {
    for (const attempt of await this.assertPullable(em, draftId)) {
      await em.update(SendAttempt, attempt.id, { status: 'cancelled', error: 'Draft changed after approval' })
      await em.update(Contact, { id: attempt.contactId, activeAttemptId: attempt.id }, { activeAttemptId: null })
    }
  }

  private signal(action: SignalAction, draft: Draft, extra: { reason?: string | null; note?: string | null; finalText?: string | null }) {
    return this.ds.getRepository(ReviewSignal).save({
      action,
      reason: extra.reason ?? null,
      note: extra.note ?? null,
      originalText: draft.originalContent ?? draft.content,
      finalText: extra.finalText ?? null,
    })
  }
}
