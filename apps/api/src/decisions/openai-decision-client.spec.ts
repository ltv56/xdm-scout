import { describe, expect, it } from 'vitest'
import { OpenAiDecisionClient } from './openai-decision-client'
import { QUESTIONS } from './questions'

// Shape from the OpenAI Decisions API reference (14 Nov 2026).
const recorded = {
  model: 'gpt-6-luna',
  answers: [{ type: 'predicate', name: 'invitation', probability: 0.95 }],
  usage: { input_tokens: 42, output_tokens: 0, total_tokens: 42 },
}
const ask = { code: 'invitation', input: 'Hi, how do I apply to the program?', sentence: null } as const

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

const make = (f: typeof fetch) => new OpenAiDecisionClient({ apiKey: 'k', fetchFn: f })

describe('OpenAiDecisionClient', () => {
  it('posts the input and one predicate question to gpt-6-luna and marks the answer as a decision-model answer', async () => {
    const { calls, fetchFn } = fakeFetch(recorded)
    const [a] = await make(fetchFn).decide([ask])
    expect(a).toEqual({ ...ask, probability: 0.95, answeredBy: 'jev', model: 'gpt-6-luna' })
    expect(calls[0].url).toBe('https://api.openai.com/v1/decisions')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: 'gpt-6-luna',
      input: ask.input,
      questions: [{ type: 'predicate', name: 'invitation', instructions: QUESTIONS.invitation.instructions }],
    })
  })

  it('rejects a refusal, a value outside 0 to 1 and an HTTP error', async () => {
    for (const bad of [
      { answers: [{ type: 'refusal', name: 'invitation' }] },
      { answers: [{ type: 'predicate', name: 'invitation', probability: 1.4 }] },
      { answers: [] },
    ]) {
      await expect(make(fakeFetch(bad).fetchFn).decide([ask])).rejects.toThrow(/invalid decision answer/)
    }
    await expect(make(fakeFetch({ error: { code: 'rate_limit_exceeded' } }, 429).fetchFn).decide([ask])).rejects.toThrow(/429.*rate_limit_exceeded/)
  })
})
