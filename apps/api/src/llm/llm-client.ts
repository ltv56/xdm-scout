export type LlmRequest = { task: 'fit' | 'verify' | 'draft' | 'decide' | 'translate' | 'reply'; system: string; user: string }

export interface LlmClient {
  completeJson(req: LlmRequest): Promise<unknown>
}

export const LLM_CLIENT = Symbol('LLM_CLIENT')
