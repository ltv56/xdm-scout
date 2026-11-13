import { describe, expect, it } from 'vitest'
import { FixtureDecisionClient } from './decision-client'
import { buildAsks, EvalFixtures, runEval } from './eval-run'

const fixtures: EvalFixtures = {
  profiles: [
    { id: 'f01', handle: 'mina', name: 'Mina', bio: 'building agents', followers: 900, labels: { own_account: true, fits_segment: true } },
    { id: 'f02', handle: 'fanpage', name: 'Fan', bio: 'unofficial fan account', followers: 50, labels: { own_account: false, fits_segment: null } },
  ],
  dms: [
    { id: 'dm1', text: 'How do I apply?', labels: { invitation: true, opt_out: false, reply_class: 'Question' } },
    { id: 'dm2', text: 'thanks!', labels: { invitation: false, opt_out: false, reply_class: 'Other' } },
    { id: 'dm3', text: 'unclear', labels: { invitation: null, opt_out: false, reply_class: null } },
  ],
  drafts: [
    {
      id: 'dr1',
      person: 'Mina',
      evidence: 'Shipped v2.',
      text: 'Hi Mina! Saw v2.',
      labels: { one_person: true, no_sensitive: true, no_familiarity: true, claim_backed: false },
    },
  ],
}

describe('buildAsks', () => {
  it('makes one ask per answered label and skips null labels', () => {
    const items = buildAsks(fixtures)
    const count = (code: string) => items.filter((i) => i.ask.code === code).length
    expect([count('own_account'), count('invitation'), count('one_person'), count('no_sensitive'), count('no_familiarity'), count('claim_backed')]).toEqual([2, 2, 1, 1, 1, 1])
  })

  it('puts the evidence next to the draft for the familiarity and claim questions', () => {
    const items = buildAsks(fixtures)
    expect(items.find((i) => i.ask.code === 'no_familiarity')?.ask.input).toContain('Evidence: "Shipped v2."')
    expect(items.find((i) => i.ask.code === 'claim_backed')?.ask.input).toContain('Evidence: "Shipped v2."')
  })
})

describe('runEval', () => {
  it('scores a model that always knows the label as perfect', async () => {
    const items = buildAsks(fixtures)
    const answers = new Map(items.map((i) => [i.ask.input + i.ask.code, i.yes ? 1 : 0]))
    const client = new FixtureDecisionClient((ask) => answers.get(ask.input + ask.code) ?? 0.5)
    const report = await runEval(client, items)
    expect(report.byCode.invitation.brier).toBe(0)
    expect(report.byCode.invitation.precision.precision).toBe(1)
    expect(report.byCode.own_account.brier).toBe(0)
  })

  it('gives a model that always says 0.5 a Brier score of 0.25', async () => {
    const report = await runEval(new FixtureDecisionClient(() => 0.5), buildAsks(fixtures))
    expect(report.byCode.invitation.brier).toBe(0.25)
    expect(report.byCode.invitation.precision.answeredYes).toBe(0)
  })
})
