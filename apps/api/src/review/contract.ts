// API contract for the review screens. Shared with apps/web (type imports only), so keep it plain zod: no enums, no Nest imports.
import { z } from 'zod'

export const campaignSummary = z.object({ id: z.number(), name: z.string() })

// A program the fund can offer. A campaign points at one of them, and the draft's offer sentence uses exactly that one.
export const program = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  link: z.string().url().max(300),
  // Last day to apply, as YYYY-MM-DD.
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

export const senderProfile = z.object({
  intro: z.string().min(1).max(400),
  programs: z.array(program).min(1).max(8),
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
  z.object({ type: z.literal('sender_profile'), field: z.enum(['intro', 'program', 'signer']) }),
  z.object({ type: z.literal('opt_out') }),
  // Made by the app from the X display name, never by the model.
  z.object({ type: z.literal('greeting') }),
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

// evidence: the posts the status rests on. Empty for unknown, because met or not met without evidence is turned into unknown.
// fact: a number or date the evidence itself holds (post date and days ago, a team size written in the bio), else null. Never a score.
// Write each criterion so that met is good: the chip colour and the wording then agree.
export const criterionResult = z.object({
  text: z.string(),
  status: z.enum(['met', 'not_met', 'unknown']),
  evidence: z.array(evidenceItem),
  fact: z.string().nullable(),
})

// A yes/no answer from the decision model: a probability, never text. model says who answered (jev, llm or fixture).
// Where a probability falls against the app's thresholds (70% and 30% to start): high counts as yes, low as no, middle is a warning.
export const decisionBand = z.enum(['high', 'middle', 'low'])

// How often a question's answers were right on hand-labelled examples, at the app's yes threshold. sample is true for fixture numbers.
export const calibration = z.object({
  examples: z.number().int().positive(),
  right: z.number().int().nonnegative(),
  low: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
  model: z.string(),
  measuredOn: z.string(),
  sample: z.boolean(),
})

export const decision = z.object({
  code: z.enum(['invitation', 'no_sensitive', 'no_familiarity', 'one_person', 'claim_backed', 'own_account']),
  // The short label the reviewer reads. The longer instructions the model gets live with the decision client.
  question: z.string(),
  // Who answered. Only Jev's probability is shown as a percentage; an LLM's own figure is uncalibrated, so only its band is shown.
  // fixture: a recorded answer, shown as sample data.
  answeredBy: z.enum(['jev', 'llm', 'fixture']),
  // Index into the draft's sentences for per-sentence questions (claims), else null.
  sentence: z.number().int().nonnegative().nullable(),
  calibration: calibration.nullable(),
  probability: z.number().min(0).max(1),
  // What the model was given, so the number can be judged against what it saw.
  input: z.string(),
  band: decisionBand,
})

export const language = z.enum(['en', 'vi', 'th', 'id'])

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
    // One factual line about our history with them ("Replied to your post on 3 Nov"), null when there is none.
    history: z.string().nullable(),
    // Their X bio, shown beside the numbers. Evidence only lists it when a sentence in the draft cites it.
    bio: z.string().nullable(),
    daysSinceActive: z.number().nullable(),
    // The language they mostly write in, counted from the posts we read. null when we could not tell.
    mainLanguage: language.nullable(),
    snapshot: metricsSnapshot,
    criteria: z.array(criterionResult),
  }),
  // The text that will be sent. The approval hash is computed on it, in whatever language it is in.
  text: z.string(),
  language,
  // An English version for the reviewer to read beside a translated draft; null when the draft is in English.
  englishText: z.string().nullable(),
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

export const languageBody = z.object({ language })

// "Write drafts": up to ten people, Strong first, then the warmer relationship, then the newer opening.
export const writeDraftsBody = z.object({ limit: z.number().int().min(1).max(10).default(10) })
export const writeDraftsResult = z.object({ drafted: z.number(), readyToDraft: z.number(), noOpening: z.number() })

// People with an opening and a Fit of Strong or Possible who have no draft yet. Nothing is drafted by itself.
export const readyToDraft = z.object({ ready: z.number() })

// What a campaign adds for the first-come lane: the program it offers, and the call post people answer by DM.
// Both call fields are null when the lane is off. callPostedAt is read-only: the server reads it off the post id.
export const campaignLane = z.object({
  programId: z.number().int().positive().nullable(),
  callPostUrl: z.string().nullable(),
  callKeyword: z.string().nullable(),
  callPostedAt: z.string().nullable(),
})
export const campaignLaneBody = campaignLane.omit({ callPostedAt: true })

// Send acts on the hash the reviewer saw when approving.
export const sendBody = z.object({ contentHash: z.string().length(64) })
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
export type Program = z.infer<typeof program>
export type Language = z.infer<typeof language>
export type CampaignLane = z.infer<typeof campaignLane>
export type WriteDraftsResult = z.infer<typeof writeDraftsResult>
export type ReadyToDraft = z.infer<typeof readyToDraft>
export type ApproveBody = z.input<typeof approveBody>
export type EditBody = z.infer<typeof editBody>
export type SkipBody = z.infer<typeof skipBody>
export type RegenerateBody = z.infer<typeof regenerateBody>
export type ManualBody = z.infer<typeof manualBody>
export type ApproveResult = z.infer<typeof approveResult>
