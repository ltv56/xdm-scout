import { StoredSentence } from './checks'

const isContact = (s: StoredSentence) => s.source?.type === 'sender_profile' && s.source.field === 'contact'

// A DM reads as lines: the greeting on its own line, then the message, then the opt-out on its own line.
export function layoutText(sentences: StoredSentence[]): string {
  return sentences.reduce((out, s, i) => {
    if (i === 0) return s.text
    const breakBefore = sentences[i - 1].source?.type === 'greeting' || s.source?.type === 'opt_out' || isContact(s)
    return `${out}${breakBefore ? '\n' : ' '}${s.text}`
  }, '')
}
