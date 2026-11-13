import { StoredSentence } from './checks'
import { DraftFrame } from './contract'

// The model's sentences go in the middle; the operator's opt-out line replaces the model's, the contact line comes last.
export function applyFrame(greeting: StoredSentence, message: StoredSentence[], frame: DraftFrame | undefined): StoredSentence[] {
  const middle = frame?.optOut ? message.filter((s) => s.source?.type !== 'opt_out') : message
  return [
    greeting,
    ...middle,
    ...(frame?.optOut ? [{ text: frame.optOut, source: { type: 'opt_out' as const } }] : []),
    ...(frame?.contactLine ? [{ text: frame.contactLine, source: { type: 'sender_profile' as const, field: 'contact' as const } }] : []),
  ]
}
