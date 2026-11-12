// API contract for the review screens. Shared with apps/web (type imports only), so keep it plain zod: no enums, no Nest imports.
import { z } from 'zod'

export const campaignSummary = z.object({ id: z.number(), name: z.string() })

export const senderProfile = z.object({
  intro: z.string().min(1).max(400),
  offers: z.array(z.string().min(1).max(120)).min(1).max(8),
  signer: z.string().min(1).max(64),
  sampleMessages: z.array(z.string().max(600)).max(3),
})

export const evidenceItem = z.object({
  id: z.number(),
  kind: z.enum(['post', 'inbound_dm', 'bio']),
  text: z.string(),
  url: z.string().nullable(),
  postedAt: z.string().nullable(),
})

// Where a sentence of the draft comes from; null = no source, the UI underlines it.
export const sentenceSource = z.discriminatedUnion('type', [
  z.object({ type: z.literal('evidence'), evidenceId: z.number() }),
  z.object({ type: z.literal('sender_profile'), field: z.enum(['intro', 'offers', 'signer']) }),
  z.object({ type: z.literal('opt_out') }),
])

export const draftSentence = z.object({ text: z.string(), source: sentenceSource.nullable() })

export const checkResult = z.object({
  code: z.enum([
    'unbacked_claim',
    'offer_not_in_profile',
    'missing_opt_out',
    'fake_familiarity',
    'has_link',
    'too_long',
    'many_questions',
    'similar_draft',
    'stale_opening',
    'generic_first_line',
  ]),
  level: z.enum(['block', 'warn']),
  message: z.string(),
  // Reviewer-written sentence without evidence: a warn the reviewer must tick before approving.
  needsConfirm: z.boolean(),
})

// Counts from the posts we read, never merged into one score. asOf and sampleSize always travel with them.
export const metricsSnapshot = z.object({
  asOf: z.string(),
  sampleSize: z.number().int().positive(),
  followers: z.number().int().nonnegative(),
  postsPerWeek: z.number().nullable(),
  engagementMedian: z.number().nullable(),
  contribution: z.enum(['builder', 'founder', 'researcher', 'commentator', 'other']),
  fundTies: z.number().int().nonnegative(),
})

export const criterionResult = z.object({ text: z.string(), status: z.enum(['met', 'not_met', 'unknown']) })

// A yes/no answer from the decision model: a probability, never text. model says who answered (jev, llm or fixture).
export const decision = z.object({
  code: z.enum(['invitation', 'policy', 'claims']),
  question: z.string(),
  probability: z.number().min(0).max(1),
  model: z.string(),
})

export const reviewItem = z.object({
  draftId: z.number(),
  contentHash: z.string().length(64),
  status: z.enum(['pending', 'approved', 'skipped', 'superseded', 'sent_manually', 'not_sent']),
  sendPath: z.enum(['API_SEND', 'HUMAN_HANDOFF']),
  kind: z.enum(['first_message', 'reply']),
  editedByReviewer: z.boolean(),
  prospect: z.object({
    xUserId: z.string(),
    handle: z.string(),
    name: z.string().nullable(),
    fit: z.enum(['strong', 'possible', 'weak', 'no_basis']),
    relationship: z.enum(['messaged_us', 'follower', 'engaged', 'adjacent', 'cold']),
    permissionNote: z.string(),
    daysSinceActive: z.number().nullable(),
    snapshot: metricsSnapshot,
    criteria: z.array(criterionResult),
  }),
  text: z.string(),
  sentences: z.array(draftSentence),
  evidence: z.array(evidenceItem),
  checks: z.array(checkResult),
  decisions: z.array(decision),
  weakestPoint: z.string(),
  recipientPreview: z.object({
    senderName: z.string(),
    senderHandle: z.string(),
    firstLine: z.string(),
    approximate: z.boolean(),
    post: z.object({ text: z.string(), url: z.string() }).nullable(),
  }),
  // Only for HUMAN_HANDOFF: opens the X compose screen for this person with the draft prefilled.
  openInXUrl: z.string().nullable(),
})

export const reviewQueue = z.object({ campaignId: z.number(), sessionSize: z.number(), items: z.array(reviewItem) })

export const skipReason = z.enum(['not_fit', 'weak_opening', 'wrong_tone', 'already_in_touch', 'other'])

export const approveBody = z.object({ contentHash: z.string().length(64), confirmedUnbacked: z.boolean().default(false) })
export const editBody = z.object({ text: z.string().min(1).max(1000) })
export const skipBody = z.object({ reason: skipReason, note: z.string().max(500).optional() })
export const regenerateBody = z.object({ note: z.string().min(1).max(500) })
export const manualBody = z.object({ outcome: z.enum(['sent', 'not_sent']) })

export const approveResult = z.object({ attemptId: z.number() })

export type CampaignSummary = z.infer<typeof campaignSummary>
export type SenderProfile = z.infer<typeof senderProfile>
export type EvidenceItem = z.infer<typeof evidenceItem>
export type DraftSentence = z.infer<typeof draftSentence>
export type CheckResult = z.infer<typeof checkResult>
export type ReviewItem = z.infer<typeof reviewItem>
export type MetricsSnapshot = z.infer<typeof metricsSnapshot>
export type Decision = z.infer<typeof decision>
export type ReviewQueue = z.infer<typeof reviewQueue>
export type SkipReason = z.infer<typeof skipReason>
export type ApproveBody = z.input<typeof approveBody>
export type EditBody = z.infer<typeof editBody>
export type SkipBody = z.infer<typeof skipBody>
export type RegenerateBody = z.infer<typeof regenerateBody>
export type ManualBody = z.infer<typeof manualBody>
export type ApproveResult = z.infer<typeof approveResult>
