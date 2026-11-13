export type DecisionCode = 'invitation' | 'no_sensitive' | 'no_familiarity' | 'one_person' | 'claim_backed' | 'own_account'

export interface DecisionAsk {
  code: DecisionCode
  input: string
  sentence: number | null
}

export interface DecisionAnswer extends DecisionAsk {
  probability: number
  answeredBy: 'jev' | 'llm' | 'fixture'
  // The model that answered; measurements are looked up by it. Fixture answers have none.
  model?: string
}

export interface DecisionClient {
  decide(asks: DecisionAsk[]): Promise<DecisionAnswer[]>
}

export class FixtureDecisionClient implements DecisionClient {
  constructor(private readonly recorded: (ask: DecisionAsk) => number = () => 0.5) {}

  async decide(asks: DecisionAsk[]): Promise<DecisionAnswer[]> {
    return asks.map((ask) => {
      const probability = this.recorded(ask)
      if (!(probability >= 0 && probability <= 1)) throw new Error(`probability ${probability} is outside 0 to 1`)
      return { ...ask, probability, answeredBy: 'fixture' }
    })
  }
}
