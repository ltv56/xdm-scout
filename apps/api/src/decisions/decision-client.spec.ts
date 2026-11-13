import { describe, expect, it } from 'vitest'
import { FixtureDecisionClient } from './decision-client'

describe('FixtureDecisionClient', () => {
  it('answers every question with a recorded probability and says it is a fixture', async () => {
    const client = new FixtureDecisionClient((ask) => (ask.code === 'no_familiarity' ? 0.08 : 0.9))
    const answers = await client.decide([
      { code: 'no_familiarity', input: 'Message: "Big fan, great to reconnect!"', sentence: null },
      { code: 'claim_backed', input: 'Sentence: "Saw your post." Evidence: "Shipped v2"', sentence: 1 },
    ])
    expect(answers).toEqual([
      { code: 'no_familiarity', input: 'Message: "Big fan, great to reconnect!"', sentence: null, probability: 0.08, answeredBy: 'fixture' },
      { code: 'claim_backed', input: 'Sentence: "Saw your post." Evidence: "Shipped v2"', sentence: 1, probability: 0.9, answeredBy: 'fixture' },
    ])
  })

  it('is unsure about anything it has no recording for', async () => {
    const [a] = await new FixtureDecisionClient().decide([{ code: 'own_account', input: 'Name: Mai. Handle: @mai.', sentence: null }])
    expect(a.probability).toBe(0.5)
  })

  it('refuses a recorded probability outside 0 to 1', async () => {
    await expect(new FixtureDecisionClient(() => 1.2).decide([{ code: 'one_person', input: 'x', sentence: null }])).rejects.toThrow(/probability/)
  })
})
