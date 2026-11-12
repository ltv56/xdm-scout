import { LlmClient, LlmRequest } from './llm-client'

type EvidenceItem = { id: string; text: string; date: string | null }

// Stand-in used when no LLM key is set: shows the flow, does not judge anyone.
export function cannedHandler(req: LlmRequest): unknown {
  if (req.task === 'verify') return { supported: true }
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
