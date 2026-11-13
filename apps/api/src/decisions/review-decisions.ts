import { Decision, ReviewItem } from '../review/contract'
import { bandOf } from './bands'
import { calibrationFor } from './calibration'
import { DecisionAsk, DecisionClient } from './decision-client'
import { QUESTIONS } from './questions'

type Input = Pick<ReviewItem, 'text' | 'sentences' | 'evidence' | 'prospect'>

export const DECISION_CLIENT = Symbol('DECISION_CLIENT')

export const isQuestion = (sentence: string) => sentence.trim().endsWith('?')

function asks(item: Input): DecisionAsk[] {
  const draft = `Message: "${item.text}"`
  const withEvidence = `${draft}\nEvidence: ${item.evidence.map((e) => `"${e.text}"`).join(' ') || 'none given'}`
  const out: DecisionAsk[] = [
    { code: 'no_sensitive', input: draft, sentence: null },
    { code: 'no_familiarity', input: withEvidence, sentence: null },
    { code: 'one_person', input: draft, sentence: null },
    { code: 'no_loaded_question', input: withEvidence, sentence: null },
  ]
  // One question per sentence that claims something: no source, or a cited post. Questions are left to no_loaded_question.
  item.sentences.forEach((s, n) => {
    if (s.source !== null && s.source.type !== 'evidence') return
    if (isQuestion(s.text)) return
    const evidenceId = s.source?.type === 'evidence' ? s.source.evidenceId : null
    const cited = item.evidence.find((e) => e.id === evidenceId)
    out.push({ code: 'claim_backed', input: `Sentence: "${s.text}"\nEvidence: ${cited ? `"${cited.text}"` : 'none given'}`, sentence: n })
  })
  const p = item.prospect
  out.push({ code: 'own_account', input: `Name: ${p.name ?? 'none'}. Handle: @${p.handle}. Followers: ${p.snapshot.followers}. Bio: ${p.bio ? `"${p.bio}"` : 'none'}`, sentence: null })
  return out
}

export async function decisionsFor(client: DecisionClient, item: Input): Promise<Decision[]> {
  const answers = await client.decide(asks(item))
  return answers.map((a) => ({
    code: a.code,
    question: QUESTIONS[a.code].label,
    answeredBy: a.answeredBy,
    sentence: a.sentence,
    calibration: a.model ? calibrationFor(a.model, a.code) : null,
    probability: a.probability,
    input: a.input,
    band: bandOf(a.probability),
  }))
}
