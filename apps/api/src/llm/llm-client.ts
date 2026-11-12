export type LlmRequest = { task: 'fit' | 'verify'; system: string; user: string }

export interface LlmClient {
  completeJson(req: LlmRequest): Promise<unknown>
}

export const LLM_CLIENT = Symbol('LLM_CLIENT')
