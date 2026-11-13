import { LlmClient, LlmRequest } from './llm-client'

type EvidenceItem = { id: string; text: string; date: string | null }
type DraftInput = { opening: { evidence_id: string; summary: string | null; text: string }; profile: { intro: string; programs: { name: string; description: string }[]; signer: string } }

function cannedDraft({ opening, profile }: DraftInput) {
  const topic = (opening.summary || opening.text).replace(/\s+/g, ' ').replace(/[.!?\s]+$/, '').slice(0, 120)
  return {
    sentences: [
      { text: `Saw your post: ${topic}.`, source: { type: 'evidence', evidence_id: opening.evidence_id } },
      { text: profile.intro, source: { type: 'sender_profile', field: 'intro' } },
      { text: `Would it help if we offered: ${(profile.programs[0]?.name ?? 'an intro').toLowerCase()}?`, source: { type: 'sender_profile', field: 'program' } },
      { text: 'No worries if not.', source: { type: 'opt_out' } },
    ],
  }
}

// Stand-in used when no LLM key is set: shows the flow, does not judge anyone.
export function cannedHandler(req: LlmRequest): unknown {
  if (req.task === 'verify') return { supported: true }
  if (req.task === 'decide') return { probability: 0.5 }
  if (req.task === 'translate') return { sentences: (JSON.parse(req.user) as { sentences: string[] }).sentences.map((text) => ({ text })) }
  if (req.task === 'draft') return cannedDraft(JSON.parse(req.user) as DraftInput)
  const evidence = (JSON.parse(req.user) as { evidence: EvidenceItem[] }).evidence
  const bio = evidence.find((e) => e.id.startsWith('bio:'))
  const post = evidence.find((e) => e.id.startsWith('post:'))
  return {
    role: 'other',
    areas: [],
    fit: 'possible',
    reasons_for: bio ? [{ claim: `Bio says: ${bio.text}`.slice(0, 200), evidence_ids: [bio.id] }] : [],
    reasons_against: [],
    unknowns: ['Canned answer: no LLM key configured'],
    opening: post
      ? { type: 'launch', summary: post.text.slice(0, 200), evidence_id: post.id, date: post.date?.slice(0, 10) ?? null }
      : { type: 'none', summary: '', evidence_id: null, date: null },
  }
}

export class FakeLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = []

  constructor(private readonly handler: (req: LlmRequest) => unknown) {}

  async completeJson(req: LlmRequest): Promise<unknown> {
    this.calls.push(req)
    return this.handler(req)
  }
}
