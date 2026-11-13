import { describe, expect, it } from 'vitest'
import { GeminiDecisionClient } from './gemini-decision-client'
import { QUESTIONS } from './questions'

// Shape from the Gemini Decisions API reference (13 Nov 2026).
const recorded = { answers: { invitation: { type: 'noul', noul: 0.99, confidence: 0.99 } }, usage: { total_input_tokens: 40, total_output_tokens: 0, total_tokens: 40 } }
const ask = { code: 'invitation', input: 'Hi, how do I apply to the program?', sentence: null } as const

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

const make = (f: typeof fetch) => new GeminiDecisionClient({ apiKey: 'k', fetchFn: f })

describe('GeminiDecisionClient', () => {
  it('posts the input and one yes/no question to gemini-decision-1 and marks the answer as a decision-model answer', async () => {
    const { calls, fetchFn } = fakeFetch(recorded)
    const [a] = await make(fetchFn).decide([ask])
    expect(a).toEqual({ ...ask, probability: 0.99, answeredBy: 'jev', model: 'gemini-decision-1' })
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/decisions')
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: 'gemini-decision-1',
      input: ask.input,
      questions: { invitation: { type: 'noul', instructions: QUESTIONS.invitation.instructions } },
    })
  })

  it('rejects an answer that is not a probability and an HTTP error', async () => {
    for (const bad of [{ answers: { invitation: { type: 'noul', noul: 1.4 } } }, { answers: { invitation: { type: 'choice' } } }, { answers: {} }]) {
      await expect(make(fakeFetch(bad).fetchFn).decide([ask])).rejects.toThrow(/invalid decision answer/)
    }
    await expect(make(fakeFetch({ error: { code: 'safety', message: 'blocked' } }, 400).fetchFn).decide([ask])).rejects.toThrow(/400.*safety/)
  })
})
