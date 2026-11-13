// Fixed data for the review screens so the web app can be built before draft generation exists.
// Only mounted with REVIEW_STUB=1; state lives in memory and resets on restart.
import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Optional, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import { ProspectsService } from '../discovery/prospects.service'
import { hashContent } from '../sending/sending.service'
import {
  approveBody,
  CampaignLane,
  campaignLaneBody,
  CheckResult,
  Decision,
  DraftSentence,
  editBody,
  Language,
  languageBody,
  manualBody,
  MetricsSnapshot,
  regenerateBody,
  ReadyToDraft,
  ReviewItem,
  SenderProfile,
  senderProfile,
  skipBody,
  writeDraftsBody,
  WriteDraftsResult,
} from './contract'

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body)
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return r.data
}

const OPT_OUT = /no worries|not interested|ignore this|no reply needed|bỏ qua nhé|không làm phiền/i
const FAKE_FAMILIARITY = /big fan|been following|love your work/i

const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean)

// A DM reads as lines: the greeting on its own line, then the message, then the opt-out line on its own.
const joinText = (sentences: DraftSentence[]) =>
  sentences.reduce((out, s, i) => (i === 0 ? s.text : `${out}${sentences[i - 1].source?.type === 'greeting' || s.source?.type === 'opt_out' ? '\n' : ' '}${s.text}`), '')

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

// Stand-in for the code-computed snapshot and the decision model; real values replace these when scoring feeds the queue.
// Every question is worded so that "yes" is the good answer.
const BAND_HIGH = 0.7
const BAND_LOW = 0.3
const bandOf = (p: number): Decision['band'] => (p >= BAND_HIGH ? 'high' : p <= BAND_LOW ? 'low' : 'middle')

const QUESTION: Record<Decision['code'], string> = {
  invitation: 'Asked us to get in touch',
  no_sensitive: 'No sensitive guesses',
  no_familiarity: 'No made-up familiarity',
  one_person: 'Written for this person',
  no_loaded_question: 'No loaded questions',
  claim_backed: 'Backed by the evidence',
  own_account: 'Looks like their own account',
}

// Wilson 95% interval for right/examples, the same way the eval will report it.
function wilson(right: number, examples: number): [number, number] {
  const z = 1.96
  const p = right / examples
  const d = 1 + (z * z) / examples
  const centre = (p + (z * z) / (2 * examples)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / examples + (z * z) / (4 * examples * examples))) / d
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

// Fixture numbers only: nothing has been measured yet, so every one is marked sample. invitation has none, to show that state.
const SAMPLE_COUNTS: Partial<Record<Decision['code'], [number, number]>> = { no_sensitive: [60, 57], no_familiarity: [55, 53], one_person: [55, 49] }
const sampleCalibration = (code: Decision['code']): Decision['calibration'] => {
  const counts = SAMPLE_COUNTS[code]
  if (!counts) return null
  const [low, high] = wilson(counts[1], counts[0])
  return { examples: counts[0], right: counts[1], low, high, model: 'jev-1.14', measuredOn: '2026-11-13', sample: true }
}

function stubDecisions(item: Pick<ReviewItem, 'kind' | 'sentences' | 'checks' | 'text' | 'prospect' | 'evidence'>): Decision[] {
  const has = (code: string) => item.checks.some((k) => k.code === code)
  const p = item.prospect
  const draft = `Message: “${item.text}”`
  const ask = (code: Decision['code'], probability: number, input: string, sentence: number | null = null): Decision => ({
    code,
    question: QUESTION[code],
    answeredBy: 'fixture',
    sentence,
    calibration: sampleCalibration(code),
    probability,
    input,
    band: bandOf(probability),
  })
  const out: Decision[] = []
  if (item.kind === 'reply') out.push(ask('invitation', 0.97, `Their message to us: ${item.evidence.find((e) => e.kind === 'inbound_dm')?.text ?? ''}`))
  out.push(ask('no_sensitive', 0.97, draft))
  out.push(ask('no_familiarity', has('fake_familiarity') ? 0.08 : 0.95, draft))
  out.push(ask('one_person', has('similar_draft') ? 0.41 : has('has_link') || has('too_long') || has('many_questions') ? 0.52 : 0.9, draft))
  out.push(ask('no_loaded_question', 0.95, draft))
  // One question per sentence that claims something: a sentence with no source, or one that cites a post. Questions are left to no_loaded_question.
  item.sentences.forEach((s, n) => {
    if (s.source !== null && s.source.type !== 'evidence') return
    if (s.text.trim().endsWith('?')) return
    const cited = s.source?.type === 'evidence' ? item.evidence.find((e) => e.id === (s.source as { evidenceId: number }).evidenceId) : undefined
    const evidence = cited ? `“${cited.text}”` : 'none given'
    out.push(ask('claim_backed', s.source === null ? 0.12 : 0.94, `Sentence: “${s.text}”
Evidence: ${evidence}`, n))
  })
  out.push(ask('own_account', p.name === null ? 0.58 : 0.96, `Name: ${p.name ?? 'none'}. Handle: @${p.handle}. Followers: ${p.snapshot.followers}. Bio: ${p.bio ? `“${p.bio}”` : 'none'}`))
  return out
}

// Stand-in for the posts a criterion rests on (the real fit step keeps the evidence ids it cited).
type Ev = ReviewItem['evidence'][number]
function backing(status: 'met' | 'not_met' | 'unknown', evidence: Ev[], i: number, handle: string, from?: 'bio'): Ev[] {
  if (status === 'unknown') return []
  if (status === 'met') return [{ ...(from === 'bio' ? evidence.find((e) => e.kind === 'bio')! : evidence[i % evidence.length]), id: 200 + i }]
  return [{ id: 900 + i, kind: 'post', text: 'Closed our Series B: 40M USD, led by a large fund. Grateful to the whole team.', url: `https://x.com/${handle}/status/9${i}`, postedAt: '2026-09-18T10:00:00Z' }]
}

const AS_OF = '2026-11-12T08:00:00Z'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Only what the evidence holds: the date of a post and how long ago it was, or a number written in a bio. Otherwise nothing.
function factOf(fact: CriterionSeed['fact'], evidence: Ev[]): string | null {
  const e = evidence[0]
  if (!e || !fact) return null
  if (fact !== 'date') return fact
  if (!e.postedAt) return null
  const days = Math.floor((new Date(AS_OF).getTime() - new Date(e.postedAt).getTime()) / 86_400_000)
  const d = new Date(e.postedAt)
  return `Post of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${days} days ago`
}
const snap = (s: Omit<MetricsSnapshot, 'asOf'>): MetricsSnapshot => ({ asOf: AS_OF, ...s })

// fact: 'date' reads the evidence's post date; any other string is a number the bio states.
interface CriterionSeed {
  text: string
  status: 'met' | 'not_met' | 'unknown'
  from?: 'bio'
  fact?: string
}
type PersonData = Pick<ReviewItem['prospect'], 'snapshot' | 'history' | 'bio'> & { criteria: CriterionSeed[] }
const PEOPLE: Record<string, PersonData> = {
  mai_builds: {
    history: null,
    bio: 'Building eval tooling for Vietnamese LLMs. Open source, written in public.',
    snapshot: snap({ sampleSize: 15, followers: 3400, postsPerWeek: 4.5, engagementMedian: 62, contribution: 'builder', fundTies: 2 }),
    criteria: [{ text: 'Based in or building for Southeast Asia', status: 'met' }, { text: 'Shipped something in the last 90 days', status: 'met', fact: 'date' }],
  },
  agentops_ken: {
    history: null,
    bio: 'Agents in production, boring infra. Singapore.',
    snapshot: snap({ sampleSize: 15, followers: 8100, postsPerWeek: 2, engagementMedian: 140, contribution: 'commentator', fundTies: 0 }),
    criteria: [{ text: 'Based in or building for Southeast Asia', status: 'met' }, { text: 'Shipped something in the last 90 days', status: 'unknown' }],
  },
  linh_ml: {
    history: 'Messaged you first on 10 Nov',
    bio: 'Founder, on-device speech models for Southeast Asian languages. Ex research engineer.',
    snapshot: snap({ sampleSize: 9, followers: 1200, postsPerWeek: 1.5, engagementMedian: 18, contribution: 'founder', fundTies: 1 }),
    criteria: [{ text: 'Based in or building for Southeast Asia', status: 'met' }],
  },
  datathanh: {
    history: 'Followed you on 28 Oct',
    bio: 'Data and OCR for Thai and Vietnamese documents.',
    snapshot: snap({ sampleSize: 6, followers: 640, postsPerWeek: 0.4, engagementMedian: 9, contribution: 'researcher', fundTies: 0 }),
    criteria: [{ text: 'Based in or building for Southeast Asia', status: 'met' }, { text: 'Active in the last 30 days', status: 'not_met', fact: 'date' }],
  },
  quang_infra: {
    history: 'Liked your post on 9 Nov',
    bio: 'Infra and inference costs. Building in Ho Chi Minh City.',
    snapshot: snap({ sampleSize: 15, followers: 2300, postsPerWeek: 5, engagementMedian: 41, contribution: 'builder', fundTies: 3 }),
    criteria: [{ text: 'Based in or building for Southeast Asia', status: 'met' }, { text: 'Shipped something in the last 90 days', status: 'met', fact: 'date' }],
  },
  hoa_agents: {
    history: null,
    bio: null,
    snapshot: snap({ sampleSize: 4, followers: 450, postsPerWeek: 1, engagementMedian: null, contribution: 'founder', fundTies: 0 }),
    criteria: [{ text: 'Based in or building for Southeast Asia', status: 'met' }, { text: 'Shipped something in the last 90 days', status: 'unknown' }],
  },
  nguyen_khue_ai: {
    history: 'Replied to your post on 3 Nov',
    bio: 'Founder at ViSpeech. Speech and language models for Vietnamese and Southeast Asia. Ex research scientist. PhD, HCMUT. Team of 12. Opinions are my own.',
    snapshot: snap({ sampleSize: 15, followers: 128400, postsPerWeek: 11.5, engagementMedian: 1280, contribution: 'founder', fundTies: 4 }),
    criteria: [
      { text: 'Based in or building for Southeast Asia', status: 'met' },
      { text: 'Shipped something in the last 90 days', status: 'met', fact: 'date' },
      { text: 'Small team (under 30 people)', status: 'met', from: 'bio', fact: 'Team of 12, in bio' },
      { text: 'Works on models, evaluation or robotics rather than only using them', status: 'unknown' },
      { text: 'Pre-Series A, no $100M+ fund yet', status: 'not_met', fact: 'date' },
    ],
  },
}

interface Seed {
  draftId: number
  sendPath: ReviewItem['sendPath']
  kind: ReviewItem['kind']
  prospect: Omit<ReviewItem['prospect'], 'snapshot' | 'criteria' | 'history' | 'bio'>
  evidence: ReviewItem['evidence']
  sentences: DraftSentence[]
  extraChecks?: CheckResult[]
  weakestPoint: string
  editedByReviewer?: boolean
}

const ev = (evidenceId: number) => ({ type: 'evidence' as const, evidenceId })
const profileField = (field: 'intro' | 'program' | 'signer') => ({ type: 'sender_profile' as const, field })
const optOut = { type: 'opt_out' as const }
const greet = (text: string): DraftSentence => ({ text, source: { type: 'greeting' } })

const SEEDS: Seed[] = [
  {
    draftId: 101,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000101', handle: 'mai_builds', name: 'Mai Tran', fit: 'strong', relationship: 'adjacent', permissionNote: 'Has not messaged you. Send it yourself in X.', daysSinceActive: 2, mainLanguage: 'vi' },
    evidence: [{ id: 1, kind: 'post', text: 'Shipped v2 of our eval harness for Vietnamese LLMs. 3x faster, open source.', url: 'https://x.com/mai_builds/status/1', postedAt: '2026-11-08T09:12:00Z' }],
    sentences: [
      greet('Hi Mai Tran!'),
      { text: 'Saw you shipped v2 of your eval harness for Vietnamese LLMs.', source: ev(1) },
      { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: profileField('intro') },
      { text: 'Would an intro to two investors who fund eval tooling be useful?', source: profileField('program') },
      { text: 'No worries if not.', source: optOut },
    ],
    weakestPoint: 'Rests on one post from 4 days ago; 3 of 15 posts on topic.',
  },
  {
    draftId: 102,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000102', handle: 'agentops_ken', name: 'Ken Lim', fit: 'possible', relationship: 'cold', permissionNote: 'Has not messaged you. Send it yourself in X.', daysSinceActive: 6, mainLanguage: 'en' },
    evidence: [{ id: 2, kind: 'post', text: 'Agents in prod need boring infra: retries, budgets, audit logs.', url: 'https://x.com/agentops_ken/status/2', postedAt: '2026-11-01T14:00:00Z' }],
    sentences: [
      greet('Hello Ken Lim!'),
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
    prospect: { xUserId: '1500000000000000103', handle: 'linh_ml', name: 'Linh Pham', fit: 'strong', relationship: 'messaged_us', permissionNote: 'Messaged you first on 10 Nov.', daysSinceActive: 0, mainLanguage: 'vi' },
    evidence: [{ id: 3, kind: 'inbound_dm', text: 'Hi! Do you look at pre-seed teams doing on-device speech models?', url: null, postedAt: '2026-11-10T03:20:00Z' }],
    sentences: [
      { text: 'Yes, pre-seed on-device speech is squarely in what we look at.', source: ev(3) },
      { text: 'Happy to set up a 20 min call this week if that works.', source: profileField('program') },
      { text: 'If the timing is off, no worries.', source: optOut },
    ],
    weakestPoint: 'Rests on their DM only; no public posts on the topic yet.',
  },
  {
    draftId: 104,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000104', handle: 'datathanh', name: 'Thanh Do', fit: 'possible', relationship: 'follower', permissionNote: 'Follows you but has not messaged you. Send it yourself in X.', daysSinceActive: 31, mainLanguage: null },
    evidence: [{ id: 4, kind: 'post', text: 'We open-sourced our Thai/Vietnamese OCR dataset.', url: 'https://x.com/datathanh/status/4', postedAt: '2026-10-05T08:00:00Z' }],
    sentences: [
      greet('Hey Thanh Do!'),
      { text: 'Saw you open-sourced the Thai/Vietnamese OCR dataset.', source: ev(4) },
      { text: 'I help run a small fund backing AI founders in Southeast Asia, see https://example.org.', source: profileField('intro') },
      { text: 'Would feedback from two portfolio teams using OCR help?', source: profileField('program') },
      { text: 'No worries if not.', source: optOut },
    ],
    extraChecks: [{ code: 'stale_opening', level: 'warn', message: 'The post is from 5 Oct (38 days ago).', needsConfirm: false }],
    weakestPoint: 'Rests on one post from 38 days ago; last active 31 days ago.',
  },
  {
    draftId: 105,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000105', handle: 'quang_infra', name: 'Quang Vu', fit: 'strong', relationship: 'engaged', permissionNote: 'Liked your post but has not messaged you. Send it yourself in X.', daysSinceActive: 1, mainLanguage: 'en' },
    evidence: [{ id: 5, kind: 'post', text: 'GPU costs for our RAG stack dropped 60% after moving to batch inference.', url: 'https://x.com/quang_infra/status/5', postedAt: '2026-11-11T11:00:00Z' }],
    sentences: [
      greet('Hi Quang Vu, hope your week is going well.'),
      { text: 'Saw your GPU costs dropped 60% after moving to batch inference.', source: ev(5) },
      { text: 'We met briefly at the Saigon AI meetup last year.', source: null },
      { text: 'Would an intro to investors who fund infra be useful?', source: profileField('program') },
      { text: 'No worries if not.', source: optOut },
    ],
    editedByReviewer: true,
    weakestPoint: 'The meetup line comes from you, not from a post.',
  },
  {
    draftId: 106,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000106', handle: 'hoa_agents', name: null, fit: 'possible', relationship: 'adjacent', permissionNote: 'Has not messaged you. Send it yourself in X.', daysSinceActive: 3, mainLanguage: null },
    evidence: [{ id: 6, kind: 'post', text: 'Hiring our first ML engineer for a voice agent startup in HCMC.', url: 'https://x.com/hoa_agents/status/6', postedAt: '2026-11-09T02:00:00Z' }],
    sentences: [
      greet('Hi there!'),
      { text: 'Saw you are hiring your first ML engineer for a voice agent startup in HCMC.', source: ev(6) },
      { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: profileField('intro') },
      { text: 'Are you raising? Would an intro to hiring partners help?', source: profileField('program') },
      { text: 'No worries if not.', source: optOut },
    ],
    extraChecks: [{ code: 'similar_draft', level: 'warn', message: 'Very close to draft 101. X forbids identical DMs.', needsConfirm: false }],
    weakestPoint: 'Rests on one hiring post; company name unknown.',
  },
  {
    // Every field at a realistic maximum, to see how long the review layout gets.
    draftId: 107,
    sendPath: 'HUMAN_HANDOFF',
    kind: 'first_message',
    prospect: { xUserId: '1500000000000000107', handle: 'nguyen_khue_ai', name: 'Nguyen Thi Minh Khue (Dr.)', fit: 'strong', relationship: 'engaged', permissionNote: 'Replied to your post on 3 Nov but has not messaged you. Send it yourself in X.', daysSinceActive: 1, mainLanguage: 'vi' },
    evidence: [
      { id: 7, kind: 'post', text: 'Today we released ViSpeech-2: 4,000 hours of conversational Vietnamese across 6 dialects, with a held-out test set we will never train on. Word error rate on Hue and Mekong speakers is down from 31% to 17%. Weights, data card and failure cases are all public.', url: 'https://x.com/nguyen_khue_ai/status/7', postedAt: '2026-11-11T07:30:00Z' },
      { id: 8, kind: 'post', text: 'We now run the model on a 120 USD phone with no network. Median latency 380 ms. The hard part was not the model, it was the audio front end.', url: 'https://x.com/nguyen_khue_ai/status/8', postedAt: '2026-11-04T10:05:00Z' },
      { id: 9, kind: 'post', text: 'Hiring two research engineers in Ho Chi Minh City. You will own evaluation for low-resource Southeast Asian languages. Remote within the region is fine.', url: 'https://x.com/nguyen_khue_ai/status/9', postedAt: '2026-10-29T03:40:00Z' },
      { id: 10, kind: 'post', text: 'Hard truth after a year of building speech models in Vietnam: the bottleneck is clean data for tones and dialects, not GPUs. We spent 70% of the budget on recording and labelling.', url: 'https://x.com/nguyen_khue_ai/status/10', postedAt: '2026-10-02T12:00:00Z' },
      { id: 11, kind: 'bio', text: 'Founder at ViSpeech. Speech and language models for Vietnamese and Southeast Asia. Ex research scientist. PhD, HCMUT. Team of 12. Opinions are my own.', url: null, postedAt: null },
    ],
    sentences: [
      greet('Hello Nguyen Thi Minh Khue, hope you are doing well.'),
      { text: 'Saw you released ViSpeech-2 with a held-out test set you will never train on.', source: ev(7) },
      { text: 'Cutting word error rate on Hue and Mekong speakers from 31% to 17% is the kind of result most teams skip.', source: ev(7) },
      { text: 'Running it on a 120 USD phone with no network is a harder problem than the model itself.', source: ev(8) },
      { text: 'Your point that clean data for tones and dialects is the bottleneck, not GPUs, matches what we hear from founders.', source: ev(10) },
      { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: profileField('intro') },
      { text: 'Would an intro to two investors who fund speech and evaluation tooling be useful?', source: profileField('program') },
      { text: 'No worries if not.', source: optOut },
    ],
    extraChecks: [{ code: 'stale_opening', level: 'warn', message: 'One post behind this draft is from 2 Oct (41 days ago).', needsConfirm: false }],
    weakestPoint: 'One of the five posts is older than 30 days, and the hiring post does not support a claim in the draft.',
  },
]

// Vietnamese drafts for the sample people whose main language is Vietnamese. Same order and same sources as the English sentences.
const optOutVi = { text: 'Không phù hợp thì bạn cứ bỏ qua nhé.', source: optOut }
const TRANSLATIONS: Partial<Record<number, Partial<Record<Language, DraftSentence[]>>>> = {
  101: {
    vi: [
      greet('Chào Mai Tran!'),
      { text: 'Mình thấy bạn vừa ra mắt bản v2 của bộ công cụ đánh giá LLM tiếng Việt.', source: ev(1) },
      { text: 'Mình giúp điều hành một quỹ nhỏ đầu tư vào các nhà sáng lập AI ở Đông Nam Á.', source: profileField('intro') },
      { text: 'Bạn có muốn mình giới thiệu hai nhà đầu tư quan tâm đến công cụ đánh giá không?', source: profileField('program') },
      optOutVi,
    ],
  },
  103: {
    vi: [
      { text: 'Có, các đội pre-seed làm mô hình giọng nói chạy trên thiết bị đúng là mảng bọn mình quan tâm.', source: ev(3) },
      { text: 'Nếu tiện, mình có thể sắp xếp một cuộc gọi 20 phút trong tuần này.', source: profileField('program') },
      { text: 'Nếu chưa phải lúc thì bạn cứ nói, mình không làm phiền nữa.', source: optOut },
    ],
  },
  107: {
    vi: [
      greet('Chào Nguyen Thi Minh Khue, hy vọng bạn đang khỏe.'),
      { text: 'Mình thấy bạn vừa phát hành ViSpeech-2 cùng bộ kiểm thử mà bạn cam kết không bao giờ dùng để huấn luyện.', source: ev(7) },
      { text: 'Giảm tỉ lệ lỗi từ 31% xuống 17% ở giọng Huế và Mê Kông là kiểu kết quả mà đa số các đội bỏ qua.', source: ev(7) },
      { text: 'Chạy mô hình trên điện thoại 120 USD không có mạng là bài toán khó hơn chính mô hình.', source: ev(8) },
      { text: 'Ý bạn rằng dữ liệu sạch cho thanh điệu và phương ngữ mới là nút thắt, không phải GPU, khớp với điều bọn mình nghe từ các nhà sáng lập.', source: ev(10) },
      { text: 'Mình giúp điều hành một quỹ nhỏ đầu tư vào các nhà sáng lập AI ở Đông Nam Á.', source: profileField('intro') },
      { text: 'Bạn có muốn mình giới thiệu hai nhà đầu tư quan tâm đến công cụ về giọng nói và đánh giá không?', source: profileField('program') },
      optOutVi,
    ],
  },
}
const LANGUAGE_NAME: Record<Language, string> = { en: 'English', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian' }

// A post id carries its time: milliseconds since X's epoch in the bits above the lowest 22.
const X_EPOCH_MS = 1288834974657
function postedAtOf(url: string): string {
  const m = /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{10,20})(?:[/?#].*)?$/.exec(url.trim())
  if (!m) throw new BadRequestException('Paste the link of a post on X, like https://x.com/yourfund/status/123')
  const at = Number((BigInt(m[1]) >> 22n) + BigInt(X_EPOCH_MS))
  if (at < Date.UTC(2010, 0, 1) || at > Date.now() + 86_400_000) throw new BadRequestException('That post id does not look right')
  return new Date(at).toISOString()
}

// People Discovery found who have no draft yet. "Write drafts" and "Draft a message" turn them into review items.
interface Candidate {
  id: number
  handle: string
  name: string
  fit: 'strong' | 'possible' | 'weak' | 'not_a_fit' | null
  relationship: 'messaged_us' | 'follower' | 'engaged' | 'adjacent' | 'cold'
  hook: string | null
  post: string
  postedAt: string
  bio: string
  url: string | null
}
type Sample = Omit<Candidate, 'id' | 'url' | 'fit' | 'relationship'> & { fit: 'strong' | 'possible' | 'not_a_fit'; relationship: 'engaged' | 'follower' | 'adjacent' | 'cold' }
const SAMPLES: Sample[] = [
  { handle: 'lan_speech', name: 'Lan Nguyen', fit: 'strong', relationship: 'engaged', hook: 'Saw you open-sourced the Vietnamese speech benchmark.', post: 'Open-sourced our Vietnamese speech benchmark: 12 datasets, one score.', postedAt: '2026-11-11T09:00:00Z', bio: 'Speech models for Vietnamese. Building in the open.' },
  { handle: 'minh_robotics', name: 'Minh Le', fit: 'strong', relationship: 'follower', hook: 'Saw you got a quadruped walking on loose gravel in Da Nang.', post: 'Our quadruped now walks on loose gravel in Da Nang. 40 minutes on one battery.', postedAt: '2026-11-10T03:00:00Z', bio: 'Legged robots, Da Nang.' },
  { handle: 'thu_agents', name: 'Thu Ha', fit: 'strong', relationship: 'adjacent', hook: 'Saw you shipped audit logs for every agent action.', post: 'Shipped audit logs for every agent action today. Customers asked, we built it.', postedAt: '2026-11-11T14:00:00Z', bio: 'Agent platform for support teams.' },
  { handle: 'bao_ocr', name: 'Bao Tran', fit: 'strong', relationship: 'cold', hook: 'Saw you released a Thai receipt OCR model.', post: 'Released a Thai receipt OCR model, 96% on our hard set. Weights are public.', postedAt: '2026-11-09T07:00:00Z', bio: 'OCR for Thai and Vietnamese receipts.' },
  { handle: 'khoa_infra', name: 'Khoa Pham', fit: 'strong', relationship: 'cold', hook: 'Saw you cut inference cost in half with quantization.', post: 'Cut our inference bill in half with 4-bit quantization. Notes on what broke.', postedAt: '2026-11-08T10:00:00Z', bio: 'Inference costs, GPUs, boring infra.' },
  { handle: 'ngoc_ml', name: 'Ngoc Bui', fit: 'possible', relationship: 'engaged', hook: 'Saw you wrote about evaluating Vietnamese chatbots without a gold set.', post: 'A thread on how we evaluate Vietnamese chatbots without a gold set.', postedAt: '2026-11-10T12:00:00Z', bio: 'ML engineer, evaluation.' },
  { handle: 'hieu_dev', name: 'Hieu Vo', fit: 'possible', relationship: 'follower', hook: 'Saw you are building a voice agent for clinics in HCMC.', post: 'Building a voice agent for small clinics in HCMC. First pilot next week.', postedAt: '2026-11-11T05:00:00Z', bio: 'Voice agents for clinics.' },
  { handle: 'an_data', name: 'An Dinh', fit: 'possible', relationship: 'adjacent', hook: 'Saw you published a labelled dataset of street signs.', post: 'Published 9k labelled street signs from Hanoi, CC-BY.', postedAt: '2026-11-07T08:00:00Z', bio: 'Datasets for computer vision.' },
  { handle: 'pham_sys', name: 'Pham Quoc', fit: 'possible', relationship: 'cold', hook: 'Saw you wrote up your move to batch inference.', post: 'Moved our RAG stack to batch inference. Latency up, cost down, here is why.', postedAt: '2026-11-11T11:00:00Z', bio: 'RAG systems.' },
  { handle: 'yen_vision', name: 'Yen Ly', fit: 'possible', relationship: 'cold', hook: 'Saw you demoed a defect detector on a real factory line.', post: 'Defect detector running on a real factory line in Binh Duong, 11 fps on a small GPU.', postedAt: '2026-11-06T09:00:00Z', bio: 'Computer vision for factories.' },
  { handle: 'tam_llm', name: 'Tam Hoang', fit: 'possible', relationship: 'cold', hook: 'Saw you are fine-tuning a small model for legal text.', post: 'Fine-tuning a 3B model on Vietnamese legal text. Early numbers look good.', postedAt: '2026-11-09T13:00:00Z', bio: 'Small language models.' },
  { handle: 'duc_embed', name: 'Duc Mai', fit: 'possible', relationship: 'adjacent', hook: 'Saw you released a Vietnamese embedding model.', post: 'Released a Vietnamese embedding model, beats the multilingual baseline on 3 of 4 tasks.', postedAt: '2026-11-05T09:00:00Z', bio: 'Embeddings and search.' },
  { handle: 'quy_quiet', name: 'Quy Ta', fit: 'possible', relationship: 'cold', hook: null, post: '', postedAt: '2026-10-01T00:00:00Z', bio: 'AI, coffee.' },
  { handle: 'vi_reposts', name: 'Vi Cao', fit: 'possible', relationship: 'cold', hook: null, post: '', postedAt: '2026-10-01T00:00:00Z', bio: 'Reposts about AI.' },
  { handle: 'daily_memes', name: 'Daily Memes', fit: 'not_a_fit', relationship: 'cold', hook: null, post: '', postedAt: '2026-10-01T00:00:00Z', bio: 'Memes.' },
]
// Used when the controller is built without the prospects service (tests): the ids are their positions in this list.
const SAMPLE_CANDIDATES: Candidate[] = SAMPLES.map((c, i) => ({ ...c, id: i + 1, url: null }))
const WARMTH = { messaged_us: 0, engaged: 1, follower: 2, adjacent: 3, cold: 4 }
const PERMISSION_NOTE = {
  messaged_us: 'Messaged you first. The app may send the reply.',
  engaged: 'Liked your post but has not messaged you. Send it yourself in X.',
  follower: 'Follows you but has not messaged you. Send it yourself in X.',
  adjacent: 'Has not messaged you. Send it yourself in X.',
  cold: 'Has not messaged you. Send it yourself in X.',
}

const SENDER = { senderName: 'GenAI Fund', senderHandle: 'genaifund' }

function person(seed: Seed, extra?: PersonData): ReviewItem['prospect'] {
  const known = extra ?? PEOPLE[seed.prospect.handle]
  return { ...seed.prospect, ...known, criteria: known.criteria.map((c, i) => {
      const evidence = backing(c.status, seed.evidence, i, seed.prospect.handle, c.from)
      return { text: c.text, status: c.status, evidence, fact: factOf(c.fact, evidence) }
    }),
  }
}

function build(seed: Seed, extra?: PersonData): ReviewItem {
  const text = joinText(seed.sentences)
  const first = seed.evidence[0]
  const checks = [...stubChecks(seed.sentences, text, seed.editedByReviewer ?? false), ...(seed.extraChecks ?? [])]
  return {
    draftId: seed.draftId,
    contentHash: hashContent(text),
    status: 'pending',
    sendPath: seed.sendPath,
    kind: seed.kind,
    editedByReviewer: seed.editedByReviewer ?? false,
    prospect: person(seed, extra),
    text,
    language: 'en',
    englishText: null,
    sentences: seed.sentences,
    evidence: seed.evidence,
    checks,
    decisions: stubDecisions({ kind: seed.kind, sentences: seed.sentences, checks, text, prospect: person(seed, extra), evidence: seed.evidence }),
    weakestPoint: seed.weakestPoint,
    recipientPreview: {
      ...SENDER,
      firstLine: text.slice(0, 60),
      approximate: true,
      post: first?.kind === 'post' && first.url ? { text: first.text, url: first.url } : null,
    },
    openInXUrl: composeUrl(seed.prospect.xUserId, text),
  }
}

// exact: the text as the reviewer typed it, line breaks included; otherwise the sentences are laid out as a DM.
function withText(item: ReviewItem, sentences: DraftSentence[], reviewerWrote: boolean, exact?: string): ReviewItem {
  const text = exact ?? joinText(sentences)
  const checks = stubChecks(sentences, text, reviewerWrote)
  return {
    ...item,
    status: 'pending',
    editedByReviewer: reviewerWrote,
    text,
    sentences,
    contentHash: hashContent(text),
    checks,
    decisions: stubDecisions({ kind: item.kind, sentences, checks, text, prospect: item.prospect, evidence: item.evidence }),
    recipientPreview: { ...item.recipientPreview, firstLine: text.slice(0, 60) },
    openInXUrl: composeUrl(item.prospect.xUserId, text),
  }
}

@Controller()
export class ReviewStubController {
  // REVIEW_STUB_EMPTY=1 starts with no drafts, so a demo database shows only what its own prospects produce.
  private items = new Map<number, ReviewItem>(process.env.REVIEW_STUB_EMPTY === '1' ? [] : SEEDS.map((s) => [s.draftId, build(s)]))
  private nextAttemptId = 5001
  private lanes = new Map<number, CampaignLane>()

  constructor(@Optional() private readonly prospects?: ProspectsService) {}
  private nextDraftId = 201
  private nextEvidenceId = 1000
  private senderProfile: SenderProfile = {
    intro: 'GenAI Fund backs early AI founders in Southeast Asia.',
    programs: [
      { id: 1, name: 'Agentic AI Build Week', description: 'A build week for AI agents across Southeast Asia. Teams ship a working solution.', link: 'https://genaifund.ai/', deadline: '2026-11-30' },
      { id: 2, name: 'FastTrack AI Accelerator', description: 'An accelerator for AI startups, with paid enterprise pilots and cloud credits.', link: 'https://genaifund.ai/', deadline: null },
      { id: 3, name: 'GenAI Open Innovation', description: 'We match an enterprise use case with a startup for a proof of concept.', link: 'https://genaifund.ai/genai-open-innovation/', deadline: null },
      { id: 4, name: 'Introductions to investors', description: 'A warm intro to investors who back your area.', link: 'https://genaifund.ai/', deadline: null },
    ],
    signer: 'Vinh',
    sampleMessages: [],
  }

  @Get('review-queue')
  queue(@Query('campaignId') campaignId: string) {
    const id = Number(campaignId)
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('campaignId must be a positive integer')
    return { campaignId: id, sessionSize: 10, items: [...this.items.values()] }
  }

  // How many people could get a draft now. Nothing is drafted by itself.
  @Get('campaigns/:id/drafts/ready')
  async readyToDraft(@Param('id', ParseIntPipe) id: number): Promise<ReadyToDraft> {
    this.checkCampaignId(id)
    return { ready: this.readyFrom(await this.candidates(id)).length }
  }

  // "Write drafts": up to ten people, Strong first, then the warmer relationship, then the newer opening.
  @Post('campaigns/:id/drafts')
  async writeDrafts(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<WriteDraftsResult> {
    this.checkCampaignId(id)
    const { limit } = parse(writeDraftsBody, body ?? {})
    const all = await this.candidates(id)
    const chosen = this.readyFrom(all)
      .sort((a, b) => (a.fit === b.fit ? 0 : a.fit === 'strong' ? -1 : 1) || WARMTH[a.relationship] - WARMTH[b.relationship] || b.postedAt.localeCompare(a.postedAt))
      .slice(0, limit)
    for (const cand of chosen) this.draftFrom(id, cand)
    const noOpening = all.filter((c) => (c.fit === 'strong' || c.fit === 'possible') && c.hook === null && !this.drafted(c.handle)).length
    return { drafted: chosen.length, readyToDraft: this.readyFrom(all).length, noOpening }
  }

  // "Draft a message" on one person from Prospects, by id: any Fit but Not a fit, and only with an opening.
  @Post('campaigns/:id/prospects/:pid/draft')
  async draftOne(@Param('id', ParseIntPipe) id: number, @Param('pid', ParseIntPipe) pid: number): Promise<ReviewItem> {
    this.checkCampaignId(id)
    const cand = (await this.candidates(id)).find((c) => c.id === pid)
    if (!cand) throw new NotFoundException('Prospect not found')
    if (this.drafted(cand.handle)) throw new ConflictException('This person already has a draft in Review')
    if (cand.fit === null) throw new ConflictException('Not scored yet')
    if (cand.fit === 'not_a_fit') throw new ConflictException('Not a fit')
    if (cand.hook === null) throw new ConflictException('No reason to reach out yet')
    return this.draftFrom(id, cand)
  }

  // The campaign's real prospects when the service is there, else the samples.
  private async candidates(campaignId: number): Promise<Candidate[]> {
    if (!this.prospects) return SAMPLE_CANDIDATES
    const rows = await this.prospects.list(campaignId)
    return rows
      .filter((r) => r.status !== 'dismissed')
      .map((r) => ({
        id: r.id,
        handle: r.handle,
        name: r.name,
        fit: r.fit,
        relationship: r.relationship,
        hook: r.opening && r.opening.freshness !== 'expired' && r.opening.summary ? `Saw your post: “${r.opening.summary}”` : null,
        post: r.opening?.summary ?? '',
        postedAt: r.opening ? new Date(r.opening.date).toISOString() : '',
        bio: r.bio,
        url: r.opening?.url ?? null,
      }))
  }

  private drafted(handle: string) {
    return [...this.items.values()].some((i) => i.prospect.handle === handle)
  }

  private readyFrom(all: Candidate[]) {
    return all.filter((c) => (c.fit === 'strong' || c.fit === 'possible') && c.hook !== null && !this.drafted(c.handle))
  }

  private draftFrom(campaignId: number, cand: Candidate): ReviewItem {
    const hook = cand.hook!
    const fit = cand.fit as 'strong' | 'possible' | 'weak'
    const postedAt = cand.postedAt
    const draftId = this.nextDraftId++
    const evidenceId = this.nextEvidenceId++
    const program = this.senderProfile.programs.find((p) => p.id === this.lane(campaignId).programId) ?? this.senderProfile.programs[0]
    const days = Math.max(0, Math.floor((new Date(AS_OF).getTime() - new Date(postedAt).getTime()) / 86_400_000))
    const seed: Seed = {
      draftId,
      sendPath: 'HUMAN_HANDOFF',
      kind: 'first_message',
      prospect: {
        xUserId: `15000000000000${String(draftId).padStart(5, '0')}`,
        handle: cand.handle,
        name: cand.name || null,
        fit,
        relationship: cand.relationship,
        permissionNote: PERMISSION_NOTE[cand.relationship],
        daysSinceActive: Math.min(days, 6),
        mainLanguage: null,
      },
      evidence: [{ id: evidenceId, kind: 'post', text: cand.post, url: cand.url ?? `https://x.com/${cand.handle}/status/${evidenceId}`, postedAt }],
      sentences: [
        greet(cand.name ? `Hi ${cand.name}!` : 'Hi there!'),
        { text: hook, source: ev(evidenceId) },
        { text: 'I help run a small fund backing AI founders in Southeast Asia.', source: profileField('intro') },
        { text: `Would you like the details of ${program.name}?`, source: profileField('program') },
        { text: 'No worries if not.', source: optOut },
      ],
      weakestPoint: `Rests on one post from ${days} days ago.`,
    }
    const known: PersonData = {
      history: null,
      bio: cand.bio || null,
      snapshot: snap({ sampleSize: 12, followers: 600 + cand.handle.length * 137, postsPerWeek: 3, engagementMedian: 30, contribution: 'builder', fundTies: 0 }),
      criteria: [{ text: 'Based in or building for Southeast Asia', status: 'met' }],
    }
    return this.put(build(seed, known))
  }

  @Patch('drafts/:id')
  edit(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { text } = parse(editBody, body)
    const item = this.get(id)
    const known = new Map(item.sentences.map((s) => [s.text, s.source]))
    const sentences = splitSentences(text).map((t) => ({ text: t, source: known.get(t) ?? (OPT_OUT.test(t) ? { type: 'opt_out' as const } : null) }))
    return this.put(withText(item, sentences, true, text.trim()))
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
    const keep = item.sentences.map((s, n) => ({ s, n })).filter(({ s, n }) => n === 0 || s.source?.type === 'opt_out')
    const shorter = withText(item, keep.map(({ s }) => s), false)
    // A translated draft keeps its English copy in step: the same sentences, in English.
    const english = SEEDS.find((x) => x.draftId === id)!.sentences
    return this.put(item.language === 'en' ? shorter : { ...shorter, englishText: joinText(keep.map(({ n }) => english[n])) })
  }

  // Drafts again in the person's language (or back in English), replacing the text. Refused after a hand edit, so that text is never lost.
  @Post('drafts/:id/language')
  language(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { language } = parse(languageBody, body)
    const item = this.get(id)
    if (item.editedByReviewer) throw new ConflictException('You edited this draft. Regenerate it first, because a new language replaces the text.')
    const english = SEEDS.find((x) => x.draftId === id)!.sentences
    if (language === 'en') return this.put({ ...withText(item, english, false), language: 'en', englishText: null })
    const sentences = TRANSLATIONS[id]?.[language]
    if (!sentences) throw new ConflictException(`The sample data has no ${LANGUAGE_NAME[language]} draft for this person`)
    return this.put({ ...withText(item, sentences, false), language, englishText: joinText(english) })
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
    if (item.status !== 'approved') throw new ConflictException('Approve the draft before sending it in X')
    return this.put({ ...item, status: outcome === 'sent' ? 'sent_manually' : 'not_sent' })
  }

  // Stand-in until Campaign has these columns: the program a campaign offers and its call post, kept in memory.
  @Get('campaign-lane/:id')
  lane(@Param('id', ParseIntPipe) id: number): CampaignLane {
    this.checkCampaignId(id)
    const saved = this.lanes.get(id)
    return { callPostUrl: null, callKeyword: null, callPostedAt: null, ...saved, programId: saved ? saved.programId : this.senderProfile.programs[0].id }
  }

  @Put('campaign-lane/:id')
  saveLane(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): CampaignLane {
    this.checkCampaignId(id)
    const { programId, callPostUrl, callKeyword } = parse(campaignLaneBody, body)
    if (programId !== null && !this.senderProfile.programs.some((p) => p.id === programId)) throw new BadRequestException('Pick a program from the sender profile')
    const keyword = callKeyword?.trim() || null
    if ((callPostUrl === null) !== (keyword === null)) throw new BadRequestException('Give both the call post and the keyword, or neither')
    if (keyword && keyword.length > 40) throw new BadRequestException('The keyword is at most 40 characters')
    const lane = { programId, callPostUrl, callKeyword: keyword, callPostedAt: callPostUrl === null ? null : postedAtOf(callPostUrl) }
    this.lanes.set(id, lane)
    return lane
  }

  private checkCampaignId(id: number) {
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('campaign id must be a positive integer')
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
