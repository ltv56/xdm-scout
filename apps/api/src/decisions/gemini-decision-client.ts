import { z } from 'zod'
import { DecisionAnswer, DecisionAsk, DecisionClient } from './decision-client'
import { errorCode } from './http-error'
import { QUESTIONS } from './questions'

const response = z.object({ answers: z.record(z.string(), z.object({ type: z.string(), noul: z.number().min(0).max(1).optional() })) })

export type GeminiDecisionConfig = { apiKey: string; model?: string; fetchFn?: typeof fetch }

// Google Decisions API: not OpenAI-compatible and not on OpenRouter. One yes/no question per call, the text goes in `input`.
export class GeminiDecisionClient implements DecisionClient {
  private readonly model: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly config: GeminiDecisionConfig) {
    this.model = config.model ?? 'gemini-decision-1'
    this.fetchFn = config.fetchFn ?? fetch
  }

  async decide(asks: DecisionAsk[]): Promise<DecisionAnswer[]> {
    return Promise.all(asks.map((ask) => this.one(ask)))
  }

  private async one(ask: DecisionAsk): Promise<DecisionAnswer> {
    const res = await this.fetchFn('https://generativelanguage.googleapis.com/v1beta/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({
        model: this.model,
        input: ask.input,
        questions: { [ask.code]: { type: 'noul', instructions: QUESTIONS[ask.code].instructions } },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Gemini Decision answered ${res.status} for ${ask.code}${await errorCode(res)}`)
    const parsed = response.safeParse(await res.json())
    const answer = parsed.success ? parsed.data.answers[ask.code] : undefined
    if (!answer || answer.type !== 'noul' || answer.noul === undefined) throw new Error(`invalid decision answer for ${ask.code}`)
    // Same value as the System One client: a decision model answered, so the UI shows its figure.
    return { ...ask, probability: answer.noul, answeredBy: 'jev', model: this.model }
  }
}
