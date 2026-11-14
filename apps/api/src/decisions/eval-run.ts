import { DecisionAsk, DecisionClient, DecisionCode } from './decision-client'
import { DEFAULT_THRESHOLDS } from './bands'
import { brier, calibrationTable, Labelled, pickThreshold, precisionCoverage, splitHalves } from './eval'
import { isQuestion } from './review-decisions'

export interface EvalFixtures {
  profiles: { id: string; handle: string; name: string; bio: string; followers: number; labels: { own_account: boolean | null; fits_segment: boolean | null } }[]
  dms: { id: string; text: string; labels: { invitation: boolean | null; opt_out: boolean; reply_class: string | null } }[]
  drafts: {
    id: string
    person: string
    evidence: string
    text: string
    labels: { one_person: boolean | null; no_sensitive: boolean | null; no_familiarity: boolean | null; claim_backed: boolean | null; no_loaded_question: boolean | null }
  }[]
}

// A claim_backed item asks once per claim sentence; the label is for the whole draft.
export interface EvalItem {
  id: string
  code: DecisionCode
  asks: DecisionAsk[]
  yes: boolean
}

// The app takes these from the sender profile (greeting, intro, program, opt-out) and asks nothing about them.
const SOURCED = [
  /^(Hi|Hello) [^,.!?]+!$/,
  /^(GenAI Fund|We are GenAI Fund)\b/,
  /^Would (a short intro to our investor network help|applications to our programme be useful|you like to hear what our programme offers)\?$/,
  /^(Feel free to ignore this|No worries if|No pressure either way|No problem at all)\b/,
]

export const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/)

export const claimSentences = (text: string) => sentencesOf(text).filter((s) => !isQuestion(s) && !SOURCED.some((re) => re.test(s)))

// Inputs have the same shape as in review-decisions.ts, so the numbers describe what the app asks.
export function buildAsks(fixtures: EvalFixtures): EvalItem[] {
  const items: EvalItem[] = []
  const add = (id: string, code: DecisionCode, inputs: string[], yes: boolean | null) => {
    if (yes !== null && inputs.length) items.push({ id, code, asks: inputs.map((input) => ({ code, input, sentence: null })), yes })
  }
  for (const p of fixtures.profiles) {
    add(p.id, 'own_account', [`Name: ${p.name}. Handle: @${p.handle}. Followers: ${p.followers}. Bio: "${p.bio}"`], p.labels.own_account)
  }
  for (const d of fixtures.dms) add(d.id, 'invitation', [`Message: "${d.text}"`], d.labels.invitation)
  for (const d of fixtures.drafts) {
    const draft = `Message: "${d.text}"`
    const evidence = `Evidence: "${d.evidence}"`
    add(d.id, 'no_sensitive', [draft], d.labels.no_sensitive)
    add(d.id, 'no_familiarity', [`${draft}\n${evidence}`], d.labels.no_familiarity)
    add(d.id, 'one_person', [draft], d.labels.one_person)
    add(d.id, 'no_loaded_question', [`${draft}\n${evidence}`], d.labels.no_loaded_question)
    // Every claim gets the draft's evidence, the harder case: the app gives "none given" to a sentence that cites nothing.
    add(d.id, 'claim_backed', claimSentences(d.text).map((s) => `Sentence: "${s}"\n${evidence}`), d.labels.claim_backed)
  }
  return items
}

// The draft is backed only if every claim is, so its weakest sentence decides.
export const itemProbability = (probabilities: number[]) => Math.min(...probabilities)

function measure(examples: Labelled[]) {
  return {
    n: examples.length,
    brier: brier(examples),
    precision: precisionCoverage(examples, DEFAULT_THRESHOLDS.high),
    calibration: calibrationTable(examples, 5),
  }
}

type Measured = ReturnType<typeof measure>

// pick and report stay at the app's threshold; tuned is what a threshold picked on pick gives on report.
export interface CodeResult extends Measured {
  pick: Measured
  report: Measured
  tuned: { picked: number | null; used: number; precision: ReturnType<typeof precisionCoverage> }
}

// Target is the lowest acceptable 95% lower bound on precision of a yes.
export async function runEval(client: DecisionClient, items: EvalItem[], { target = 0.9 }: { target?: number } = {}) {
  if (!(target > 0 && target < 1)) throw new Error(`target ${target} must be between 0 and 1`)
  const answers = await client.decide(items.flatMap((i) => i.asks))
  let at = 0
  const labelled = items.map((item) => {
    const probability = itemProbability(answers.slice(at, (at += item.asks.length)).map((a) => a.probability))
    return { code: item.code, probability, yes: item.yes }
  })
  const codes = [...new Set(labelled.map((l) => l.code))]
  const byCode = {} as Record<DecisionCode, CodeResult>
  for (const code of codes) {
    const examples = labelled.filter((l) => l.code === code)
    const { pick, report } = splitHalves(examples)
    const picked = pickThreshold(pick, { target })
    const used = picked ?? DEFAULT_THRESHOLDS.high
    byCode[code] = { ...measure(examples), pick: measure(pick), report: measure(report), tuned: { picked, used, precision: precisionCoverage(report, used) } }
  }
  return { byCode }
}
