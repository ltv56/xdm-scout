import { z } from 'zod'
import { DecisionAnswer, DecisionAsk, DecisionClient } from './decision-client'
import { errorCode } from './http-error'
import { QUESTIONS } from './questions'

const response = z.object({ answers: z.array(z.object({ type: z.string(), probability: z.number().min(0).max(1).optional() })) })

export type OpenAiDecisionConfig = { apiKey: string; model?: string; fetchFn?: typeof fetch }

// OpenAI Decisions API: questions share one input, so each ask (its own input) is one call.
export class OpenAiDecisionClient implements DecisionClient {
  private readonly model: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly config: OpenAiDecisionConfig) {
    this.model = config.model ?? 'gpt-6-luna'
    this.fetchFn = config.fetchFn ?? fetch
  }

  async decide(asks: DecisionAsk[]): Promise<DecisionAnswer[]> {
    return Promise.all(asks.map((ask) => this.one(ask)))
  }

  private async one(ask: DecisionAsk): Promise<DecisionAnswer> {
    const res = await this.fetchFn('https://api.openai.com/v1/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        input: ask.input,
        questions: [{ type: 'predicate', name: ask.code, instructions: QUESTIONS[ask.code].instructions }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`OpenAI Decisions answered ${res.status} for ${ask.code}${await errorCode(res)}`)
    const parsed = response.safeParse(await res.json())
    const answer = parsed.success ? parsed.data.answers[0] : undefined
    if (!answer || answer.type !== 'predicate' || answer.probability === undefined) throw new Error(`invalid decision answer for ${ask.code}`)
    return { ...ask, probability: answer.probability, answeredBy: 'jev', model: this.model }
  }
}
