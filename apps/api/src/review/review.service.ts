import { Injectable, NotFoundException } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import { Prospect, XPost } from '../discovery/entities'
import { Evidence } from '../fit/entities'
import { Contact, Draft, SendAttempt, SenderAccount, XUser } from '../sending/entities'
import { apiSendBlock, hashContent } from '../sending/sending.service'
import { Setting } from '../setting.entity'
import { mainLanguage } from './main-language'
import { runChecks, StoredSentence } from './checks'
import { EvidenceItem, MetricsSnapshot, ReviewItem, ReviewQueue, SenderProfile, senderProfile } from './contract'

const SESSION_SIZE = 10
const DAY = 86_400_000
const PREVIEW_CHARS = 60

type Context = {
  profile: SenderProfile
  sender: SenderAccount | null
  prospects: Map<number, Prospect>
  users: Map<string, XUser>
  contacts: Map<number, Contact>
  evidence: Map<string, Evidence>
  posts: Map<string, XPost[]>
  texts: Map<number, string>
  manualSent: Set<number>
}

export const composeUrl = (xUserId: string, text: string) => `https://x.com/messages/compose?recipient_id=${xUserId}&text=${encodeURIComponent(text)}`

@Injectable()
export class ReviewService {
  constructor(private readonly ds: DataSource) {}

  async queue(campaignId: number, now = new Date()): Promise<ReviewQueue> {
    const { prospects, live } = await this.liveDrafts(campaignId)
    return { campaignId, sessionSize: SESSION_SIZE, items: await this.render(live.slice(0, SESSION_SIZE), live, prospects, now) }
  }

  // One draft as the queue shows it, whatever its status; similar-draft checks still look at the live ones.
  async one(draftId: number, now = new Date()): Promise<ReviewItem> {
    const draft = await this.ds.getRepository(Draft).findOneBy({ id: draftId })
    const prospect = draft?.prospectId ? await this.ds.getRepository(Prospect).findOneBy({ id: draft.prospectId }) : null
    if (!draft || !prospect) throw new NotFoundException('Draft not found')
    const { prospects, live } = await this.liveDrafts(prospect.campaignId)
    return (await this.render([draft], live.some((d) => d.id === draft.id) ? live : [...live, draft], prospects, now))[0]
  }

  private async liveDrafts(campaignId: number) {
    const prospects = await this.ds.getRepository(Prospect).findBy({ campaignId })
    const live = prospects.length
      ? await this.ds.getRepository(Draft).find({ where: { prospectId: In(prospects.map((p) => p.id)), status: In(['pending', 'approved']) }, order: { id: 'ASC' } })
      : []
    return { prospects, live }
  }

  private async render(shown: Draft[], live: Draft[], prospects: Prospect[], now: Date) {
    const ctx = await this.context(prospects, shown, live)
    return shown.map((d) => this.item(d, ctx, now))
  }

  private item(draft: Draft, ctx: Context, now: Date): ReviewItem {
    const prospect = ctx.prospects.get(draft.prospectId!)!
    const user = ctx.users.get(prospect.xUserId)
    const contact = ctx.contacts.get(draft.contactId)!
    const sentences = draft.sentences ?? []
    const posts = ctx.posts.get(prospect.xUserId) ?? []

    const evidence = this.evidenceFor(prospect, sentences, ctx)
    const idOf = new Map(evidence.map((e) => [e.key, e.item.id]))
    const checks = runChecks({
      sentences,
      profile: ctx.profile,
      openingDate: prospect.openingDate,
      now,
      reviewerEdited: draft.editedByReviewer,
      otherTexts: [...ctx.texts].filter(([id]) => id !== draft.id).map(([, t]) => t),
    })
    const opening = prospect.openingEvidenceId ? ctx.evidence.get(prospect.openingEvidenceId) : undefined

    return {
      draftId: draft.id,
      contentHash: hashContent(draft.content),
      status: draft.status === 'approved' && ctx.manualSent.has(draft.id) ? 'sent_manually' : draft.status,
      sendPath: draft.sendPath,
      kind: draft.kind,
      editedByReviewer: draft.editedByReviewer,
      prospect: {
        xUserId: prospect.xUserId,
        handle: user?.handle ?? '',
        name: user?.name ?? null,
        fit: prospect.fit === 'strong' || prospect.fit === 'possible' || prospect.fit === 'weak' ? prospect.fit : 'no_basis',
        relationship: prospect.relationship,
        permissionNote: permissionNote(contact, now),
        history: null,
        bio: user?.bio ?? null,
        mainLanguage: mainLanguage(posts),
        daysSinceActive: posts.length ? Math.floor((now.getTime() - Math.max(...posts.map((p) => p.postedAt.getTime()))) / DAY) : null,
        snapshot: snapshot(prospect, user, posts, now),
        criteria: (prospect.criteria ?? []).map((c) => ({ text: c.text, status: c.status, evidence: [], fact: null })),
      },
      text: draft.content,
      language: draft.language,
      englishText: draft.englishText,
      sentences: sentences.map((s) => ({
        text: s.text,
        source: !s.source ? null : s.source.type === 'evidence' ? (idOf.has(s.source.evidenceId) ? { type: 'evidence', evidenceId: idOf.get(s.source.evidenceId)! } : null) : s.source,
      })),
      evidence: evidence.map((e) => e.item),
      checks,
      decisions: [],
      weakestPoint: weakestPoint(sentences, evidence, prospect, now),
      recipientPreview: {
        senderName: ctx.sender?.handle ?? '',
        senderHandle: ctx.sender?.handle ?? '',
        firstLine: draft.content.slice(0, PREVIEW_CHARS),
        approximate: true,
        post: opening?.kind === 'post' ? { text: opening.excerpt || prospect.openingSummary || '', url: opening.url } : null,
      },
      openInXUrl: draft.sendPath === 'HUMAN_HANDOFF' ? composeUrl(prospect.xUserId, draft.content) : null,
    }
  }

  // The opening first, then whatever else the draft cites; numbered from 1 for this item.
  private evidenceFor(prospect: Prospect, sentences: StoredSentence[], ctx: Context) {
    const keys = [prospect.openingEvidenceId, ...sentences.flatMap((s) => (s.source?.type === 'evidence' ? [s.source.evidenceId] : []))]
    const out: { key: string; item: EvidenceItem }[] = []
    for (const key of keys) {
      const e = key ? ctx.evidence.get(key) : undefined
      if (!key || !e || out.some((o) => o.key === key)) continue
      out.push({ key, item: { id: out.length + 1, kind: e.kind, text: e.excerpt, url: e.url, postedAt: e.postedAt?.toISOString() ?? null } })
    }
    return out
  }

  private async context(prospects: Prospect[], drafts: Draft[], live: Draft[]): Promise<Context> {
    const xUserIds = prospects.map((p) => p.xUserId)
    const evidenceIds = [...prospects.map((p) => p.openingEvidenceId), ...drafts.flatMap((d) => (d.sentences ?? []).map((s) => (s.source?.type === 'evidence' ? s.source.evidenceId : null)))].filter((x): x is string => !!x)
    const row = await this.ds.getRepository(Setting).findOneBy({ key: 'sender_profile' })
    const parsed = senderProfile.safeParse(row?.value)
    const posts = xUserIds.length ? await this.ds.getRepository(XPost).findBy({ xUserId: In(xUserIds) }) : []
    const postsBy = new Map<string, XPost[]>()
    for (const p of posts) postsBy.set(p.xUserId, [...(postsBy.get(p.xUserId) ?? []), p])
    return {
      profile: parsed.success ? parsed.data : { intro: '', programs: [], signer: '', sampleMessages: [] },
      sender: (await this.ds.getRepository(SenderAccount).find({ order: { id: 'ASC' }, take: 1 }))[0] ?? null,
      prospects: new Map(prospects.map((p) => [p.id, p])),
      users: new Map((xUserIds.length ? await this.ds.getRepository(XUser).findBy({ xUserId: In(xUserIds) }) : []).map((u) => [u.xUserId, u])),
      contacts: new Map((drafts.length ? await this.ds.getRepository(Contact).findBy({ id: In(drafts.map((d) => d.contactId)) }) : []).map((c) => [c.id, c])),
      evidence: new Map((evidenceIds.length ? await this.ds.getRepository(Evidence).findBy({ id: In(evidenceIds) }) : []).map((e) => [e.id, e])),
      posts: postsBy,
      manualSent: new Set((drafts.length ? await this.ds.getRepository(SendAttempt).findBy({ draftId: In(drafts.map((d) => d.id)), route: 'manual', status: In(['manual_unverified', 'sent']) }) : []).map((a) => a.draftId)),
      texts: new Map(live.map((d) => [d.id, (d.sentences ?? []).map((s) => s.text).join(' ') || d.content])),
    }
  }
}

function permissionNote(contact: Contact, now: Date) {
  const blocked = apiSendBlock(contact, now)
  if (!blocked) return contact.invitationAt ? `Messaged you first on ${contact.invitationAt.getUTCDate()} ${contact.invitationAt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}.` : 'Messaged you first.'
  return 'Has not messaged you. Send it yourself in X.'
}

function snapshot(prospect: Prospect, user: XUser | undefined, posts: XPost[], now: Date): MetricsSnapshot {
  const times = posts.map((p) => p.postedAt.getTime())
  const spanDays = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / DAY : 0
  const role = prospect.role
  return {
    asOf: now.toISOString(),
    sampleSize: Math.max(1, posts.length),
    followers: user?.followers ?? 0,
    postsPerWeek: spanDays >= 1 ? Math.round((posts.length / (spanDays / 7)) * 10) / 10 : null,
    engagementMedian: null,
    contribution: role === 'builder' || role === 'founder' || role === 'researcher' ? role : 'other',
    fundTies: prospect.seedCount,
  }
}

function weakestPoint(sentences: StoredSentence[], evidence: { item: EvidenceItem }[], prospect: Prospect, now: Date) {
  const unbacked = sentences.find((s) => s.source === null)
  if (unbacked) return `"${unbacked.text.slice(0, 50)}" has no post behind it.`
  const posts = evidence.filter((e) => e.item.kind === 'post')
  const dates = posts.flatMap((e) => (e.item.postedAt ? [new Date(e.item.postedAt).getTime()] : []))
  const unknown = (prospect.criteria ?? []).filter((c) => c.status === 'unknown').length
  const parts: string[] = []
  if (dates.length) {
    const days = Math.floor((now.getTime() - Math.min(...dates)) / DAY)
    parts.push(`Rests on ${posts.length === 1 ? 'one post' : `${posts.length} posts`} from ${days} ${days === 1 ? 'day' : 'days'} ago`)
  }
  if (unknown) parts.push(`${unknown} ${unknown === 1 ? 'criterion' : 'criteria'} unknown`)
  return parts.length ? `${parts.join('; ')}.` : 'Nothing backs this draft except the profile.'
}
