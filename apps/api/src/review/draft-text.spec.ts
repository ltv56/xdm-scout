import { describe, expect, it } from 'vitest'
import { StoredSentence } from './checks'
import { layoutText } from './draft-text'

const hi: StoredSentence = { text: 'Hi Mai!', source: { type: 'greeting' } }
const post: StoredSentence = { text: 'Saw your eval harness.', source: { type: 'evidence', evidenceId: 'post:1' } }
const offer: StoredSentence = { text: 'We back early AI founders.', source: { type: 'sender_profile', field: 'intro' } }
const optOut: StoredSentence = { text: 'No worries if not.', source: { type: 'opt_out' } }

describe('layoutText', () => {
  it('lays a first message out like a DM: greeting line, message, opt-out line', () => {
    expect(layoutText([hi, post, offer, optOut])).toBe('Hi Mai!\nSaw your eval harness. We back early AI founders.\nNo worries if not.')
  })

  it('sets only the opt-out apart in a reply, which has no greeting', () => {
    expect(layoutText([post, offer, optOut])).toBe('Saw your eval harness. We back early AI founders.\nNo worries if not.')
  })

  it('puts the contact line last, on its own line after the opt-out', () => {
    const contact: StoredSentence = { text: 'Write to vinh@genaifund.ai', source: { type: 'sender_profile', field: 'contact' } }
    expect(layoutText([hi, post, optOut, contact])).toBe('Hi Mai!\nSaw your eval harness.\nNo worries if not.\nWrite to vinh@genaifund.ai')
  })

  it('keeps one line when there is neither', () => {
    expect(layoutText([post, offer])).toBe('Saw your eval harness. We back early AI founders.')
    expect(layoutText([])).toBe('')
  })
})
