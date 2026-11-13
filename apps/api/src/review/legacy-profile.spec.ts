import { describe, expect, it } from 'vitest'
import { senderProfile } from './contract'
import { upgradeProfile, upgradeSentences } from './legacy-profile'

describe('upgradeProfile', () => {
  it('turns each offer into a program with an id and a default link', () => {
    const out = upgradeProfile({ intro: 'We back founders.', offers: ['Intro to investors', 'Founder dinner'], signer: 'Vinh', sampleMessages: [] })
    expect(out.programs).toEqual([
      { id: 1, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null },
      { id: 2, name: 'Founder dinner', description: 'Founder dinner', link: 'https://genaifund.ai/', deadline: null },
    ])
    expect('offers' in out).toBe(false)
    expect(senderProfile.safeParse(out).success).toBe(true)
  })

  it('leaves a profile that already has programs alone', () => {
    const p = { intro: 'x', programs: [{ id: 3, name: 'A', description: 'B', link: 'https://a.io/', deadline: null }], signer: 's', sampleMessages: [] }
    expect(upgradeProfile(p)).toEqual(p)
  })
})

describe('upgradeSentences', () => {
  it("renames the 'offers' source field to 'program'", () => {
    const out = upgradeSentences([{ text: 'a', source: { type: 'sender_profile', field: 'offers' } }, { text: 'b', source: null }])
    expect(out).toEqual([{ text: 'a', source: { type: 'sender_profile', field: 'program' } }, { text: 'b', source: null }])
  })
})
