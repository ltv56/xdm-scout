import { z } from 'zod'
import { DecisionAnswer, DecisionAsk, DecisionClient } from './decision-client'
import { QUESTIONS } from './questions'

const response = z.object({ answers: z.record(z.string(), z.object({ type: z.string(), noul: z.number().min(0).max(1).optional() })) })

export type JevConfig = { apiKey: string; baseUrl?: string; model?: string; fetchFn?: typeof fetch }

// One yes/no question per call: the state differs per ask. Pinned model; the System One endpoint on OpenRouter is alpha.
export class JevDecisionClient implements DecisionClient {
  private readonly baseUrl: string
  private readonly model: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly config: JevConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')
    this.model = config.model ?? 'typesafe/jev-1.14'
    this.fetchFn = config.fetchFn ?? fetch
  }

  async decide(asks: DecisionAsk[]): Promise<DecisionAnswer[]> {
    return Promise.all(asks.map((ask) => this.one(ask)))
  }

  private async one(ask: DecisionAsk): Promise<DecisionAnswer> {
    const res = await this.fetchFn(`${this.baseUrl}/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        state: { input: ask.input },
        questions: { [ask.code]: { type: 'noul', instructions: QUESTIONS[ask.code].instructions } },
      }),
    })
    if (!res.ok) throw new Error(`Jev answered ${res.status} for ${ask.code}`)
    const parsed = response.safeParse(await res.json())
    const answer = parsed.success ? parsed.data.answers[ask.code] : undefined
    if (!answer || answer.type !== 'noul' || answer.noul === undefined) throw new Error(`invalid decision answer for ${ask.code}`)
    return { ...ask, probability: answer.noul, answeredBy: 'jev' }
  }
}
