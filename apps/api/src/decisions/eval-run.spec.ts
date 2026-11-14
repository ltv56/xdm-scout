import { describe, expect, it } from 'vitest'
import { FixtureDecisionClient } from './decision-client'
import { buildAsks, claimSentences, EvalFixtures, runEval } from './eval-run'

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
      text: 'Hi Mina! Saw v2. We heard about your divorce. GenAI Fund backs early AI teams. No pressure either way.',
      labels: { one_person: true, no_sensitive: false, no_familiarity: true, claim_backed: false, no_loaded_question: true },
    },
    {
      id: 'dr2',
      person: 'Lan',
      evidence: 'Raised a seed round.',
      text: 'Hi Lan! GenAI Fund backs early AI teams. Feel free to ignore this if the timing is off.',
      labels: { one_person: false, no_sensitive: true, no_familiarity: true, claim_backed: true, no_loaded_question: true },
    },
  ],
}

describe('buildAsks', () => {
  it('makes one ask per answered label and skips null labels', () => {
    const items = buildAsks(fixtures)
    const count = (code: string) => items.filter((i) => i.code === code).length
    expect([count('own_account'), count('invitation'), count('one_person'), count('no_sensitive'), count('no_familiarity'), count('claim_backed'), count('no_loaded_question')]).toEqual([2, 2, 2, 2, 2, 1, 2])
  })

  it('puts the evidence next to the draft for the familiarity and claim questions', () => {
    const items = buildAsks(fixtures)
    expect(items.find((i) => i.code === 'no_familiarity')?.asks[0].input).toContain('Evidence: "Shipped v2."')
    expect(items.find((i) => i.code === 'claim_backed')?.asks[0].input).toContain('Evidence: "Shipped v2."')
  })

  it('asks claim_backed once per claim sentence, like the app, and skips a draft without claims', () => {
    const claim = buildAsks(fixtures).filter((i) => i.code === 'claim_backed')
    expect(claim.map((i) => i.id)).toEqual(['dr1'])
    expect(claim[0].asks.map((a) => a.input.split('\n')[0])).toEqual(['Sentence: "Saw v2."', 'Sentence: "We heard about your divorce."'])
  })
})

describe('claimSentences', () => {
  it('drops the greeting, the fund intro, the program offer, the opt-out and questions', () => {
    const text = 'Hi Tomas! Saw your gripper at 0.2 mm. We are GenAI Fund, an early fund. Would applications to our programme be useful? Are you raising? No problem at all if now is not the time.'
    expect(claimSentences(text)).toEqual(['Saw your gripper at 0.2 mm.'])
  })

  it('keeps a greeting that carries a claim', () => {
    expect(claimSentences('Hi Tomas, your retrieval in 0.2 seconds caught my eye. No pressure either way.')).toEqual(['Hi Tomas, your retrieval in 0.2 seconds caught my eye.'])
  })
})

describe('runEval', () => {
  it('scores a model that always knows the label as perfect', async () => {
    const items = buildAsks(fixtures)
    const answers = new Map(items.flatMap((i) => i.asks.map((a) => [a.input + a.code, i.yes ? 1 : 0])))
    const client = new FixtureDecisionClient((ask) => answers.get(ask.input + ask.code) ?? 0.5)
    const report = await runEval(client, items)
    expect(report.byCode.invitation.brier).toBe(0)
    expect(report.byCode.invitation.precision.precision).toBe(1)
    expect(report.byCode.own_account.brier).toBe(0)
  })

  it('scores a draft by its weakest claim sentence', async () => {
    const client = new FixtureDecisionClient((ask) => (ask.input.includes('divorce') ? 0.2 : 0.95))
    const report = await runEval(client, buildAsks(fixtures).filter((i) => i.code === 'claim_backed'))
    expect(report.byCode.claim_backed.calibration[1]).toMatchObject({ n: 1, meanProbability: 0.2 })
  })

  describe('thresholds', () => {
    const dms = Array.from({ length: 40 }, (_, n) => ({ id: `dm${n}`, text: `message ${n}`, labels: { invitation: n % 2 === 0, opt_out: false, reply_class: null } }))
    const items = buildAsks({ profiles: [], dms, drafts: [] })

    it('picks the threshold on the first half and measures the second half at it', async () => {
      const truth = new Map(items.map((i) => [i.asks[0].input, i.yes ? 1 : 0]))
      const report = await runEval(new FixtureDecisionClient((ask) => truth.get(ask.input) ?? 0.5), items, { target: 0.7 })
      const { tuned } = report.byCode.invitation
      expect([tuned.picked, tuned.used]).toEqual([0.5, 0.5])
      expect(tuned.precision).toMatchObject({ n: 20, answeredYes: 10, right: 10 })
    })

    it('falls back to the default threshold when none reaches the target', async () => {
      const report = await runEval(new FixtureDecisionClient(() => 0.5), items, { target: 0.7 })
      const { tuned } = report.byCode.invitation
      expect([tuned.picked, tuned.used]).toEqual([null, 0.7])
      expect(tuned.precision.answeredYes).toBe(0)
    })

    it('keeps the report half at the app threshold for the calibration figures', async () => {
      const report = await runEval(new FixtureDecisionClient(() => 0.6), items, { target: 0.2 })
      expect(report.byCode.invitation.tuned.used).toBe(0.5)
      expect(report.byCode.invitation.report.precision.answeredYes).toBe(0)
    })

    it('refuses a target outside 0 to 1', async () => {
      await expect(runEval(new FixtureDecisionClient(() => 0.5), items, { target: 1.5 })).rejects.toThrow('target 1.5')
    })
  })

  it('gives a model that always says 0.5 a Brier score of 0.25', async () => {
    const report = await runEval(new FixtureDecisionClient(() => 0.5), buildAsks(fixtures))
    expect(report.byCode.invitation.brier).toBe(0.25)
    expect(report.byCode.invitation.precision.answeredYes).toBe(0)
  })
})
