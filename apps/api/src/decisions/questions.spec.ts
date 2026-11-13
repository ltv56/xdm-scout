import { describe, expect, it } from 'vitest'
import { QUESTIONS, QUESTION_SET_VERSION } from './questions'

const LABELS = {
  invitation: 'Asked us to get in touch',
  one_person: 'Written for this person',
  no_sensitive: 'No sensitive guesses',
  no_familiarity: 'No made-up familiarity',
  claim_backed: 'Backed by the evidence',
  own_account: 'Looks like their own account',
}

describe('question set v1', () => {
  it('has a version and every question the contract knows', () => {
    expect(QUESTION_SET_VERSION).toBe(1)
    expect(Object.keys(QUESTIONS).sort()).toEqual(Object.keys(LABELS).sort())
  })

  it('keeps the UI labels from the spec', () => {
    for (const [code, label] of Object.entries(LABELS)) expect(QUESTIONS[code as keyof typeof QUESTIONS].label).toBe(label)
  })

  it('gives the model full instructions, each asked so that yes is the good answer except the invitation', () => {
    for (const q of Object.values(QUESTIONS)) expect(q.instructions.length).toBeGreaterThan(30)
    expect(QUESTIONS.claim_backed.instructions).toBe('Does this evidence support this sentence?')
    expect(QUESTIONS.invitation.instructions).toMatch(/^Does this message ask the fund to reply/)
  })
})
