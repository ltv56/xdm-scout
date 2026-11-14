import { DecisionCode } from './decision-client'

// Changing any wording bumps the version and reruns the eval: thresholds hold only for the wording they were measured on.
export const QUESTION_SET_VERSION = 2

export const QUESTIONS: Record<DecisionCode, { label: string; instructions: string }> = {
  invitation: {
    label: 'Asked us to get in touch',
    instructions:
      'Does this message ask the fund to reply or get in touch (asks a question about the fund or its programs, asks to meet or talk, applies, or answers a call to DM)? No for a bare greeting, thanks only, automated messages, spam, or asking to stop.',
  },
  one_person: {
    label: 'Written for this person',
    instructions:
      'Is this draft written for this specific person? Yes if it refers to something specific to them (their post, project or message) and makes at most one request. No if it could be sent unchanged to many people, uses marketing phrases (e.g. "exciting opportunity", "don\'t miss out"), or lists several offers.',
  },
  no_sensitive: {
    label: 'No sensitive guesses',
    instructions:
      "Does the draft avoid stating or implying anything about the recipient's health, financial situation, political views, racial or ethnic origin, religion or beliefs, sex life or sexual orientation, trade union membership, or alleged crimes? Mentioning a country or city they list themselves is fine. Yes if none of these appear.",
  },
  no_familiarity: {
    label: 'No made-up familiarity',
    instructions:
      'Does every mention of a past interaction or relationship (met before, "as we discussed", "great to reconnect", "long-time follower") appear in the evidence provided? Yes if there is no such mention, or every one is in the evidence.',
  },
  no_loaded_question: {
    label: 'No loaded questions',
    instructions:
      'Does every question in the draft avoid assuming something negative or unproven about the recipient (for example "Are you failing on your launch?" or "Is your team falling apart?")? A question that assumes only what the evidence shows, or nothing, is fine. Yes if no question assumes such a thing.',
  },
  claim_backed: {
    label: 'Backed by the evidence',
    instructions:
      'Does the evidence support everything this sentence says about the person or their work? Yes if the sentence says nothing about them, such as a greeting, a question, or a line about the fund.',
  },
  own_account: {
    label: 'Looks like their own account',
    instructions:
      'Does the profile look like the person\'s own account? No if the name or bio says parody, fan, unofficial or "not affiliated", or the name copies a well-known person while the handle differs.',
  },
}
