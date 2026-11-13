import { CheckResult, SenderProfile } from './contract'

export type StoredSource =
  | { type: 'evidence'; evidenceId: string }
  | { type: 'sender_profile'; field: 'intro' | 'program' | 'signer' | 'contact' }
  | { type: 'opt_out' }
  // Made by the app from the X display name; there is nothing in it to verify.
  | { type: 'greeting' }

export type StoredSentence = { text: string; source: StoredSource | null }

export type CheckInput = {
  sentences: StoredSentence[]
  profile: SenderProfile
  openingDate: Date | null
  now: Date
  reviewerEdited: boolean
  otherTexts: string[]
}

const MAX_CHARS = 450
const STALE_DAYS = 30
const SIMILAR_AT = 0.8
const FAKE_FAMILIARITY = /big fan|been following|love your work/i
const OPT_OUT = /no worries|no pressure|not interested|ignore this|feel free to ignore|no reply needed/i

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
const longWords = (s: string) => [...words(s)].filter((w) => w.length >= 4)

function similarity(a: string, b: string) {
  const wa = words(a)
  const wb = words(b)
  const shared = [...wa].filter((w) => wb.has(w)).length
  return shared / Math.max(1, new Set([...wa, ...wb]).size)
}

const formatDay = (d: Date) => `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`

export function runChecks(input: CheckInput): CheckResult[] {
  const { sentences, profile, openingDate, now, reviewerEdited, otherTexts } = input
  const text = sentences.map((s) => s.text).join(' ')
  const out: CheckResult[] = []

  if (sentences.some((s) => s.source === null)) {
    out.push(
      reviewerEdited
        ? { code: 'unbacked_claim', level: 'warn', message: 'You added a sentence with no post behind it. Tick to confirm.', needsConfirm: true }
        : { code: 'unbacked_claim', level: 'block', message: 'A personal sentence has no post behind it.', needsConfirm: false },
    )
  }

  const offerWords = new Set(profile.programs.flatMap((p) => longWords(`${p.name} ${p.description}`)))
  const badOffer = sentences.find((s) => s.source?.type === 'sender_profile' && s.source.field === 'program' && !longWords(s.text).some((w) => offerWords.has(w)))
  if (badOffer) out.push({ code: 'offer_not_in_profile', level: 'block', message: 'This offer is not in your sender profile.', needsConfirm: false })

  if (!sentences.some((s) => s.source?.type === 'opt_out') && !OPT_OUT.test(text)) {
    out.push({ code: 'missing_opt_out', level: 'block', message: 'Add a line that lets them say no.', needsConfirm: false })
  }
  if (FAKE_FAMILIARITY.test(text)) out.push({ code: 'fake_familiarity', level: 'block', message: "Sounds like you know them. You don't.", needsConfirm: false })

  if (/https?:\/\//i.test(text)) out.push({ code: 'has_link', level: 'warn', message: 'A first message should not carry a link.', needsConfirm: false })
  if (text.length > MAX_CHARS) out.push({ code: 'too_long', level: 'warn', message: `${text.length} characters; aim for ${MAX_CHARS}.`, needsConfirm: false })
  if ((text.match(/\?/g) ?? []).length > 1) out.push({ code: 'many_questions', level: 'warn', message: 'More than one question.', needsConfirm: false })
  if (otherTexts.some((o) => similarity(o, text) >= SIMILAR_AT)) {
    out.push({ code: 'similar_draft', level: 'warn', message: 'Very close to another draft in the queue. X forbids identical DMs.', needsConfirm: false })
  }
  if (openingDate) {
    const days = Math.floor((now.getTime() - openingDate.getTime()) / 86_400_000)
    if (days > STALE_DAYS) out.push({ code: 'stale_opening', level: 'warn', message: `The post is from ${formatDay(openingDate)} (${days} days ago).`, needsConfirm: false })
  }
  // The greeting is made by the app, so the first line to judge is the first sentence after it.
  const first = sentences.find((s) => s.source?.type !== 'greeting')
  if (first && first.source !== null && first.source.type !== 'evidence') {
    out.push({ code: 'generic_first_line', level: 'warn', message: 'The first line says nothing specific about them.', needsConfirm: false })
  }
  return out
}
