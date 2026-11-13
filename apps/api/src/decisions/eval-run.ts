import { DecisionAsk, DecisionClient, DecisionCode } from './decision-client'
import { DEFAULT_THRESHOLDS } from './bands'
import { brier, calibrationTable, Labelled, precisionCoverage, splitHalves } from './eval'

export interface EvalFixtures {
  profiles: { id: string; handle: string; name: string; bio: string; followers: number; labels: { own_account: boolean | null; fits_segment: boolean | null } }[]
  dms: { id: string; text: string; labels: { invitation: boolean | null; opt_out: boolean; reply_class: string | null } }[]
  drafts: {
    id: string
    person: string
    evidence: string
    text: string
    labels: { one_person: boolean | null; no_sensitive: boolean | null; no_familiarity: boolean | null; claim_backed: boolean | null }
  }[]
}

export interface EvalItem {
  id: string
  ask: DecisionAsk
  yes: boolean
}

// Inputs have the same shape as in review-decisions.ts, so the numbers describe what the app asks.
export function buildAsks(fixtures: EvalFixtures): EvalItem[] {
  const items: EvalItem[] = []
  const add = (id: string, code: DecisionCode, input: string, yes: boolean | null) => {
    if (yes !== null) items.push({ id, ask: { code, input, sentence: null }, yes })
  }
  for (const p of fixtures.profiles) {
    add(p.id, 'own_account', `Name: ${p.name}. Handle: @${p.handle}. Followers: ${p.followers}. Bio: "${p.bio}"`, p.labels.own_account)
  }
  for (const d of fixtures.dms) add(d.id, 'invitation', `Message: "${d.text}"`, d.labels.invitation)
  for (const d of fixtures.drafts) {
    const draft = `Message: "${d.text}"`
    const evidence = `Evidence: "${d.evidence}"`
    add(d.id, 'no_sensitive', draft, d.labels.no_sensitive)
    add(d.id, 'no_familiarity', `${draft}\n${evidence}`, d.labels.no_familiarity)
    add(d.id, 'one_person', draft, d.labels.one_person)
    add(d.id, 'claim_backed', `Sentence: "${d.text}"\n${evidence}`, d.labels.claim_backed)
  }
  return items
}

function measure(examples: Labelled[]) {
  const { high } = DEFAULT_THRESHOLDS
  return {
    n: examples.length,
    brier: brier(examples),
    precision: precisionCoverage(examples, high),
    calibration: calibrationTable(examples, 5),
  }
}

export async function runEval(client: DecisionClient, items: EvalItem[]) {
  const answers = await client.decide(items.map((i) => i.ask))
  const labelled = items.map((item, n) => ({ code: item.ask.code, probability: answers[n].probability, yes: item.yes }))
  const codes = [...new Set(labelled.map((l) => l.code))]
  const byCode = {} as Record<DecisionCode, ReturnType<typeof measure> & { pick: ReturnType<typeof measure>; report: ReturnType<typeof measure> }>
  for (const code of codes) {
    const examples = labelled.filter((l) => l.code === code)
    const { pick, report } = splitHalves(examples)
    byCode[code] = { ...measure(examples), pick: measure(pick), report: measure(report) }
  }
  return { byCode }
}
