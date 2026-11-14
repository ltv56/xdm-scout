import { describe, expect, it } from 'vitest'
import { SystemOneDecisionClient } from './system-one-decision-client'
import { QUESTIONS } from './questions'

// Shape recorded from the OpenRouter System One reference (13 Nov 2026).
const recorded = { answers: { invitation: { noul: 0.96, type: 'noul' } }, id: 'gen-dec-1', model: 'typesafe/jev-1.14-20261014', provider: 'TypeSafe', usage: { cost: 0.00002, input_tokens: 476, output_tokens: 70 } }

const ask = { code: 'invitation', input: 'Hi, how do I apply to the program?', sentence: null } as const

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

const make = (f: typeof fetch) => new SystemOneDecisionClient({ apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1', model: 'typesafe/jev-1.14', fetchFn: f })

describe('SystemOneDecisionClient', () => {
  it('posts the pinned model, the input as state and the question as a yes/no, and marks the answer jev', async () => {
    const { calls, fetchFn } = fakeFetch(recorded)
    const [a] = await make(fetchFn).decide([ask])
    expect(a).toEqual({ ...ask, probability: 0.96, answeredBy: 'jev', model: 'typesafe/jev-1.14' })
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/systemone')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: 'typesafe/jev-1.14',
      state: { input: ask.input },
      questions: { invitation: { type: 'noul', instructions: QUESTIONS.invitation.instructions } },
    })
  })

  it('rejects an answer that is not a probability, a refusal and an HTTP error', async () => {
    for (const bad of [{ ...recorded, answers: { invitation: { noul: 1.4, type: 'noul' } } }, { ...recorded, answers: { invitation: { type: 'refusal' } } }, { ...recorded, answers: {} }]) {
      await expect(make(fakeFetch(bad).fetchFn).decide([ask])).rejects.toThrow(/invalid decision answer/)
    }
    await expect(make(fakeFetch({ error: { code: 402, message: 'Insufficient credits' } }, 402).fetchFn).decide([ask])).rejects.toThrow(/402/)
  })

})
