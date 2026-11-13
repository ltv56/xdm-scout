export type LlmRequest = { task: 'fit' | 'verify' | 'draft' | 'translate'; system: string; user: string }

export interface LlmClient {
  completeJson(req: LlmRequest): Promise<unknown>
}

export const LLM_CLIENT = Symbol('LLM_CLIENT')
