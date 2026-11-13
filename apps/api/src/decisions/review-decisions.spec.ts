import { describe, expect, it } from 'vitest'
import { Decision, ReviewItem } from '../review/contract'
import { DecisionClient, FixtureDecisionClient } from './decision-client'
import { decisionsFor } from './review-decisions'

type Input = Pick<ReviewItem, 'text' | 'sentences' | 'evidence' | 'prospect'>

const item: Input = {
  text: 'Hi Mai!\nSaw your post. We back founders. Want an intro?\nNo worries if not.',
  sentences: [
    { text: 'Hi Mai!', source: { type: 'greeting' } },
    { text: 'Saw your post: shipped v2.', source: { type: 'evidence', evidenceId: 1 } },
    { text: 'We back founders.', source: { type: 'sender_profile', field: 'intro' } },
    { text: 'You will love it.', source: null },
    { text: 'No worries if not.', source: { type: 'opt_out' } },
  ],
  evidence: [{ id: 1, kind: 'post', text: 'Shipped v2 of our eval harness', url: null, postedAt: null }],
  prospect: { name: 'Mai', handle: 'mai', bio: 'Evals', snapshot: { followers: 3400 } } as ReviewItem['prospect'],
}

const byCode = (ds: Decision[], code: string) => ds.filter((d) => d.code === code)

const measuredClient = (model: string): DecisionClient => ({
  decide: async (asks) => asks.map((ask) => ({ ...ask, probability: 0.9, answeredBy: 'jev' as const, model })),
})

describe('decisionsFor', () => {
  it('asks the three policy questions on the whole message, one claim question per sentence that claims something, and own_account', async () => {
    const ds = await decisionsFor(new FixtureDecisionClient((a) => (a.code === 'claim_backed' && a.sentence === 3 ? 0.1 : 0.9)), item)
    expect(ds.map((d) => d.code)).toEqual(['no_sensitive', 'no_familiarity', 'one_person', 'claim_backed', 'claim_backed', 'own_account'])
    expect(byCode(ds, 'claim_backed').map((d) => d.sentence)).toEqual([1, 3])
    for (const d of ds.filter((d) => d.code !== 'claim_backed')) expect(d.sentence).toBeNull()
  })

  it('fills question, band, input and says who answered; no calibration yet', async () => {
    const ds = await decisionsFor(new FixtureDecisionClient((a) => (a.code === 'claim_backed' && a.sentence === 3 ? 0.1 : 0.5)), item)
    const [sensitive] = byCode(ds, 'no_sensitive')
    expect(sensitive).toMatchObject({ question: 'No sensitive guesses', answeredBy: 'fixture', band: 'middle', calibration: null, probability: 0.5 })
    expect(sensitive.input).toContain(item.text)
    const [backed, unbacked] = byCode(ds, 'claim_backed')
    expect(backed.input).toContain('Saw your post: shipped v2.')
    expect(backed.input).toContain('Shipped v2 of our eval harness')
    expect(unbacked).toMatchObject({ band: 'low' })
    expect(unbacked.input).toContain('none given')
    expect(byCode(ds, 'own_account')[0].input).toContain('@mai')
  })

  it('attaches the measurement of the answering model to the policy questions only', async () => {
    const ds = await decisionsFor(measuredClient('gpt-6-luna'), item)
    for (const d of ds.filter((d) => ['no_sensitive', 'no_familiarity', 'one_person'].includes(d.code))) {
      expect(d.calibration).toMatchObject({ model: 'gpt-6-luna', sample: false })
    }
    for (const d of ds.filter((d) => ['claim_backed', 'own_account'].includes(d.code))) expect(d.calibration).toBeNull()
  })

  it('leaves calibration empty for a model that was never measured', async () => {
    const ds = await decisionsFor(measuredClient('never-measured'), item)
    expect(ds.every((d) => d.calibration === null)).toBe(true)
  })
})
