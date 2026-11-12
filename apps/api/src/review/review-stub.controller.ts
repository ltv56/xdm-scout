// Fixed data for the review screens so the web app can be built before draft generation exists.
// Only mounted with REVIEW_STUB=1; state lives in memory and resets on restart.
import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import { hashContent } from '../sending/sending.service'
import {
  approveBody,
  CheckResult,
  DraftSentence,
  editBody,
  manualBody,
  regenerateBody,
  ReviewItem,
  SenderProfile,
  senderProfile,
  skipBody,
} from './contract'

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body)
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return r.data
}

const OPT_OUT = /no worries|not interested|ignore this|no reply needed/i
const FAKE_FAMILIARITY = /big fan|been following|love your work/i

const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean)

const composeUrl = (xUserId: string, text: string) =>
  `https://x.com/messages/compose?recipient_id=${xUserId}&text=${encodeURIComponent(text)}`

// Rough version of the section 6 checks, enough to show every state in the UI.
function stubChecks(sentences: DraftSentence[], text: string, reviewerWrote: boolean): CheckResult[] {
  const out: CheckResult[] = []
  if (sentences.some((s) => s.source === null)) {
    out.push(
      reviewerWrote
        ? { code: 'unbacked_claim', level: 'warn', message: 'You added a sentence with no post behind it. Tick to confirm.', needsConfirm: true }
        : { code: 'unbacked_claim', level: 'block', message: 'A personal sentence has no post behind it.', needsConfirm: false },
    )
  }
  if (FAKE_FAMILIARITY.test(text)) out.push({ code: 'fake_familiarity', level: 'block', message: 'Sounds like you know them. You don\'t.', needsConfirm: false })
  if (!OPT_OUT.test(text)) out.push({ code: 'missing_opt_out', level: 'block', message: 'Add a line that lets them say no.', needsConfirm: false })
  if (/https?:\/\//.test(text)) out.push({ code: 'has_link', level: 'warn', message: 'A first message should not carry a link.', needsConfirm: false })
  if (text.length > 450) out.push({ code: 'too_long', level: 'warn', message: `${text.length} characters; aim for 450.`, needsConfirm: false })
  if ((text.match(/\?/g) ?? []).length > 1) out.push({ code: 'many_questions', level: 'warn', message: 'More than one question.', needsConfirm: false })
  return out
}

interface Seed {
  draftId: number
  sendPath: ReviewItem['sendPath']
  kind: ReviewItem['kind']
  prospect: ReviewItem['prospect']
  evidence: ReviewItem['evidence']
  sentences: DraftSentence[]
  extraChecks?: CheckResult[]
  weakestPoint: string
  editedByReviewer?: boolean
}

const ev = (evidenceId: number) => ({ type: 'evidence' as const, evidenceId })
const profileField = (field: 'intro' | 'offers' | 'signer') => ({ type: 'sender_profile' as const, field })
const optOut = { type: 'opt_out' as const }

const SEEDS: Seed[] = [
  {
    draftId: 101,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000101', handle: 'mai_builds', name: 'Mai Tran', fit: 'strong', relationship: 'adjacent', permissionNote: 'Has not messaged you. Send it yourself in X.', daysSinceActive: 2 },
    evidence: [{ id: 1, kind: 'post', text: 'Shipped v2 of our eval harness for Vietnamese LLMs. 3x faster, open source.', url: 'https://x.com/mai_builds/status/1', postedAt: '2026-11-08T09:12:00Z' }],
    sentences: [
      { text: 'Saw you shipped v2 of your eval harness for Vietnamese LLMs.', source: ev(1) },
      { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: profileField('intro') },
      { text: 'Would an intro to two investors who fund eval tooling be useful?', source: profileField('offers') },
      { text: 'No worries if not.', source: optOut },
    ],
    weakestPoint: 'Rests on one post from 4 days ago; 3 of 15 posts on topic.',
  },
  {
    draftId: 102,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000102', handle: 'agentops_ken', name: 'Ken Lim', fit: 'possible', relationship: 'cold', permissionNote: 'Has not messaged you. Send it yourself in X.', daysSinceActive: 6 },
    evidence: [{ id: 2, kind: 'post', text: 'Agents in prod need boring infra: retries, budgets, audit logs.', url: 'https://x.com/agentops_ken/status/2', postedAt: '2026-11-01T14:00:00Z' }],
    sentences: [
      { text: 'Big fan of your take that agents need boring infra.', source: ev(2) },
      { text: 'You clearly have the best agent platform in Singapore.', source: null },
      { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: profileField('intro') },
      { text: 'No worries if not.', source: optOut },
    ],
    weakestPoint: '"Best agent platform" has no post behind it.',
  },
  {
    draftId: 103,
    sendPath: 'API_SEND',
    kind: 'reply',
    prospect: { xUserId: '1500000000000000103', handle: 'linh_ml', name: 'Linh Pham', fit: 'strong', relationship: 'messaged_us', permissionNote: 'Messaged you first on 10 Nov.', daysSinceActive: 0 },
    evidence: [{ id: 3, kind: 'inbound_dm', text: 'Hi! Do you look at pre-seed teams doing on-device speech models?', url: null, postedAt: '2026-11-10T03:20:00Z' }],
    sentences: [
      { text: 'Yes, pre-seed on-device speech is squarely in what we look at.', source: ev(3) },
      { text: 'Happy to set up a 20 min call this week if that works.', source: profileField('offers') },
      { text: 'If the timing is off, no worries.', source: optOut },
    ],
    weakestPoint: 'Rests on their DM only; no public posts on the topic yet.',
  },
  {
    draftId: 104,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000104', handle: 'datathanh', name: 'Thanh Do', fit: 'possible', relationship: 'follower', permissionNote: 'Follows you but has not messaged you. Send it yourself in X.', daysSinceActive: 31 },
    evidence: [{ id: 4, kind: 'post', text: 'We open-sourced our Thai/Vietnamese OCR dataset.', url: 'https://x.com/datathanh/status/4', postedAt: '2026-10-05T08:00:00Z' }],
    sentences: [
      { text: 'Saw you open-sourced the Thai/Vietnamese OCR dataset.', source: ev(4) },
      { text: 'I help run a small fund backing AI founders in Southeast Asia, see https://example.org.', source: profileField('intro') },
      { text: 'Would feedback from two portfolio teams using OCR help?', source: profileField('offers') },
      { text: 'No worries if not.', source: optOut },
    ],
    extraChecks: [{ code: 'stale_opening', level: 'warn', message: 'The post is from 5 Oct (38 days ago).', needsConfirm: false }],
    weakestPoint: 'Rests on one post from 38 days ago; last active 31 days ago.',
  },
  {
    draftId: 105,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000105', handle: 'quang_infra', name: 'Quang Vu', fit: 'strong', relationship: 'engaged', permissionNote: 'Liked your post but has not messaged you. Send it yourself in X.', daysSinceActive: 1 },
    evidence: [{ id: 5, kind: 'post', text: 'GPU costs for our RAG stack dropped 60% after moving to batch inference.', url: 'https://x.com/quang_infra/status/5', postedAt: '2026-11-11T11:00:00Z' }],
    sentences: [
      { text: 'Saw your GPU costs dropped 60% after moving to batch inference.', source: ev(5) },
      { text: 'We met briefly at the Saigon AI meetup last year.', source: null },
      { text: 'Would an intro to investors who fund infra be useful?', source: profileField('offers') },
      { text: 'No worries if not.', source: optOut },
    ],
    editedByReviewer: true,
    weakestPoint: 'The meetup line comes from you, not from a post.',
  },
  {
    draftId: 106,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000106', handle: 'hoa_agents', name: null, fit: 'possible', relationship: 'adjacent', permissionNote: 'Has not messaged you. Send it yourself in X.', daysSinceActive: 3 },
    evidence: [{ id: 6, kind: 'post', text: 'Hiring our first ML engineer for a voice agent startup in HCMC.', url: 'https://x.com/hoa_agents/status/6', postedAt: '2026-11-09T02:00:00Z' }],
    sentences: [
      { text: 'Saw you are hiring your first ML engineer for a voice agent startup in HCMC.', source: ev(6) },
      { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: profileField('intro') },
      { text: 'Are you raising? Would an intro to hiring partners help?', source: profileField('offers') },
      { text: 'No worries if not.', source: optOut },
    ],
    extraChecks: [{ code: 'similar_draft', level: 'warn', message: 'Very close to draft 101. X forbids identical DMs.', needsConfirm: false }],
    weakestPoint: 'Rests on one hiring post; company name unknown.',
  },
]

const SENDER = { senderName: 'GenAI Fund', senderHandle: 'genaifund' }

function build(seed: Seed): ReviewItem {
  const text = seed.sentences.map((s) => s.text).join(' ')
  const first = seed.evidence[0]
  return {
    draftId: seed.draftId,
    contentHash: hashContent(text),
    status: 'pending',
    sendPath: seed.sendPath,
    kind: seed.kind,
    editedByReviewer: seed.editedByReviewer ?? false,
    prospect: seed.prospect,
    text,
    sentences: seed.sentences,
    evidence: seed.evidence,
    checks: [...stubChecks(seed.sentences, text, seed.editedByReviewer ?? false), ...(seed.extraChecks ?? [])],
    weakestPoint: seed.weakestPoint,
    recipientPreview: {
      ...SENDER,
      firstLine: text.slice(0, 60),
      approximate: true,
      post: first?.kind === 'post' && first.url ? { text: first.text, url: first.url } : null,
    },
    openInXUrl: seed.sendPath === 'HUMAN_HANDOFF' ? composeUrl(seed.prospect.xUserId, text) : null,
  }
}

function withText(item: ReviewItem, sentences: DraftSentence[], reviewerWrote: boolean): ReviewItem {
  const text = sentences.map((s) => s.text).join(' ')
  return {
    ...item,
    status: 'pending',
    editedByReviewer: reviewerWrote,
    text,
    sentences,
    contentHash: hashContent(text),
    checks: stubChecks(sentences, text, reviewerWrote),
    recipientPreview: { ...item.recipientPreview, firstLine: text.slice(0, 60) },
    openInXUrl: item.sendPath === 'HUMAN_HANDOFF' ? composeUrl(item.prospect.xUserId, text) : null,
  }
}

@Controller()
export class ReviewStubController {
  private items = new Map<number, ReviewItem>(SEEDS.map((s) => [s.draftId, build(s)]))
  private nextAttemptId = 5001
  private senderProfile: SenderProfile = {
    intro: 'GenAI Fund backs early AI founders in Southeast Asia.',
    offers: ['Intro to investors', 'Feedback from portfolio teams', 'Invite to our founder dinner'],
    signer: 'Vinh',
    sampleMessages: [],
  }

  @Get('review-queue')
  queue(@Query('campaignId') campaignId: string) {
    const id = Number(campaignId)
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('campaignId must be a positive integer')
    return { campaignId: id, sessionSize: 10, items: [...this.items.values()] }
  }

  @Patch('drafts/:id')
  edit(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { text } = parse(editBody, body)
    const item = this.get(id)
    const known = new Map(item.sentences.map((s) => [s.text, s.source]))
    const sentences = splitSentences(text).map((t) => ({ text: t, source: known.get(t) ?? (OPT_OUT.test(t) ? { type: 'opt_out' as const } : null) }))
    return this.put(withText(item, sentences, true))
  }

  @Post('drafts/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { contentHash, confirmedUnbacked } = parse(approveBody, body)
    const item = this.get(id)
    if (item.status !== 'pending') throw new ConflictException('This draft is no longer in the queue')
    if (contentHash !== item.contentHash) throw new ConflictException('The draft changed since you read it. Review it again.')
    if (item.checks.some((k) => k.level === 'block')) throw new ConflictException('Fix the blocking checks first')
    if (item.checks.some((k) => k.needsConfirm) && !confirmedUnbacked) throw new ConflictException('Confirm the sentences you added')
    this.put({ ...item, status: 'approved' })
    return { attemptId: this.nextAttemptId++ }
  }

  @Post('drafts/:id/skip')
  skip(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    parse(skipBody, body)
    return this.put({ ...this.get(id), status: 'skipped' })
  }

  @Post('drafts/:id/regenerate')
  regenerate(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    parse(regenerateBody, body)
    const item = this.get(id)
    const [opening, ...rest] = item.sentences
    const shorter = [opening, ...rest.filter((s) => s.source?.type === 'opt_out')]
    return this.put(withText(item, shorter, false))
  }

  @Post('drafts/:id/dnc')
  dnc(@Param('id', ParseIntPipe) id: number) {
    const { xUserId } = this.get(id).prospect
    for (const [key, i] of this.items) if (i.prospect.xUserId === xUserId) this.items.delete(key)
    return { ok: true }
  }

  @Post('drafts/:id/manual')
  manual(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { outcome } = parse(manualBody, body)
    const item = this.get(id)
    if (item.sendPath !== 'HUMAN_HANDOFF') throw new ConflictException('This draft is sent by the app, not by hand')
    if (item.status !== 'approved') throw new ConflictException('Approve the draft before sending it in X')
    return this.put({ ...item, status: outcome === 'sent' ? 'sent_manually' : 'not_sent' })
  }

  @Get('sender-profile')
  profile() {
    return this.senderProfile
  }

  @Put('sender-profile')
  saveProfile(@Body() body: unknown) {
    this.senderProfile = parse(senderProfile, body)
    return this.senderProfile
  }

  private get(id: number) {
    const item = this.items.get(id)
    if (!item) throw new NotFoundException('Draft not found')
    return item
  }

  private put(item: ReviewItem) {
    this.items.set(item.draftId, item)
    return item
  }
}
