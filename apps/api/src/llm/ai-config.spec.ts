import { describe, expect, it } from 'vitest'
import { FixtureDecisionClient } from '../decisions/decision-client'
import { GeminiDecisionClient } from '../decisions/gemini-decision-client'
import { LlmDecisionClient } from '../decisions/llm-decision-client'
import { SystemOneDecisionClient } from '../decisions/system-one-decision-client'
import { createDecisionClient, createLlmClient, routeDecision, routeText } from './ai-config'
import { FakeLlmClient } from './fake-llm-client'
import { AnthropicLlmClient, OpenAiCompatibleLlmClient } from './http-llm-clients'

const all = { google: 'g', openRouter: 'o', anthropic: 'a', openai: 'p' }

describe('routeText', () => {
  it('uses the maker key first, then OpenRouter', () => {
    expect(routeText('claude-sonnet-x', all)).toEqual({ provider: 'anthropic', model: 'claude-sonnet-x' })
    expect(routeText('claude-sonnet-x', { openRouter: 'o' })).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet-x' })
    expect(routeText('gpt-x', all)).toEqual({ provider: 'openai', model: 'gpt-x' })
    expect(routeText('gpt-x', { openRouter: 'o' })).toEqual({ provider: 'openrouter', model: 'openai/gpt-x' })
    expect(routeText('gemini-4-hydrogen', all)).toEqual({ provider: 'google', model: 'gemini-4-hydrogen' })
    expect(routeText('gemini-4-hydrogen', { openRouter: 'o' })).toEqual({ provider: 'openrouter', model: 'google/gemini-4-hydrogen' })
  })

  it('uses the DeepSeek key for deepseek-* names, else OpenRouter', () => {
    expect(routeText('deepseek-chat', { ...all, deepseek: 'd' })).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(routeText('deepseek-chat', { openRouter: 'o' })).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-chat' })
    expect(() => routeText('deepseek-chat', { google: 'g' })).toThrow(/DEEPSEEK_API_KEY or OPEN_ROUTER_API_KEY/)
  })

  it('sends vendor/model names to OpenRouter as they are', () => {
    expect(routeText('nvidia/nemotron-3-ultra:free', all)).toEqual({ provider: 'openrouter', model: 'nvidia/nemotron-3-ultra:free' })
  })

  it('tries an unknown name on OpenRouter and says so when there is no key for it', () => {
    expect(routeText('mystery-1', { openRouter: 'o' })).toEqual({ provider: 'openrouter', model: 'mystery-1' })
    expect(() => routeText('mystery-1', { google: 'g' })).toThrow(/mystery-1.*OPEN_ROUTER_API_KEY/)
  })

  it('names the keys that would serve a known model', () => {
    expect(() => routeText('claude-x', { google: 'g' })).toThrow(/ANTHROPIC_API_KEY or OPEN_ROUTER_API_KEY/)
    expect(() => routeText('gemini-x', {})).toThrow(/GOOGLE_API_KEY or OPEN_ROUTER_API_KEY/)
  })

  it('treats an empty name as off', () => {
    expect(routeText('', all)).toBeNull()
  })
})

describe('createLlmClient with DeepSeek', () => {
  it('reads the key from DEEPSEEK_API_KEY or LLM_API_KEY', () => {
    expect(createLlmClient({ LLM_MODEL: 'deepseek-chat', DEEPSEEK_API_KEY: 'd' })).toBeInstanceOf(OpenAiCompatibleLlmClient)
    expect(createLlmClient({ LLM_MODEL: 'deepseek-chat', LLM_API_KEY: 'd' })).toBeInstanceOf(OpenAiCompatibleLlmClient)
  })
})

describe('routeDecision', () => {
  it('sends gemini-decision-1 to Google and System One models to OpenRouter', () => {
    expect(routeDecision('gemini-decision-1', all)).toEqual({ kind: 'google-decision', model: 'gemini-decision-1' })
    expect(routeDecision('typesafe/jev-1.14', all)).toEqual({ kind: 'system-one', model: 'typesafe/jev-1.14' })
    expect(routeDecision('perplexity/pplx-decider-v1.3:free', all)).toEqual({ kind: 'system-one', model: 'perplexity/pplx-decider-v1.3:free' })
  })

  it('sends gpt-6-luna to the OpenAI Decisions API and needs the OpenAI key for it', () => {
    expect(routeDecision('gpt-6-luna', all)).toEqual({ kind: 'openai-decision', model: 'gpt-6-luna' })
    expect(() => routeDecision('gpt-6-luna', { google: 'g' })).toThrow(/OPENAI_API_KEY/)
  })

  it('asks an ordinary model through the LLM route, so its figure is not calibrated', () => {
    expect(routeDecision('claude-x', all)).toEqual({ kind: 'llm', route: { provider: 'anthropic', model: 'claude-x' } })
    expect(routeDecision('gemini-4-hydrogen', { google: 'g' })).toEqual({ kind: 'llm', route: { provider: 'google', model: 'gemini-4-hydrogen' } })
  })

  it('needs the key that serves the decision endpoint', () => {
    expect(() => routeDecision('gemini-decision-1', { openRouter: 'o' })).toThrow(/GOOGLE_API_KEY/)
    expect(() => routeDecision('typesafe/jev-1.14', { google: 'g' })).toThrow(/OPEN_ROUTER_API_KEY/)
  })

  it('treats an empty name as off', () => {
    expect(routeDecision('', all)).toBeNull()
  })
})

describe('createLlmClient', () => {
  it('builds the client for the route and falls back to the canned one when the model is empty', () => {
    expect(createLlmClient({ GOOGLE_API_KEY: 'g', LLM_MODEL: 'gemini-4-hydrogen' })).toBeInstanceOf(OpenAiCompatibleLlmClient)
    expect(createLlmClient({ ANTHROPIC_API_KEY: 'a', LLM_MODEL: 'claude-x' })).toBeInstanceOf(AnthropicLlmClient)
    expect(createLlmClient({ GOOGLE_API_KEY: 'g' })).toBeInstanceOf(FakeLlmClient)
  })
})

describe('createDecisionClient', () => {
  const llm = new FakeLlmClient(() => ({}))
  it('builds the client for the route', () => {
    expect(createDecisionClient({ GOOGLE_API_KEY: 'g', DECISION_MODEL: 'gemini-decision-1' }, llm)).toBeInstanceOf(GeminiDecisionClient)
    expect(createDecisionClient({ OPEN_ROUTER_API_KEY: 'o', DECISION_MODEL: 'typesafe/jev-1.14' }, llm)).toBeInstanceOf(SystemOneDecisionClient)
    expect(createDecisionClient({ ANTHROPIC_API_KEY: 'a', DECISION_MODEL: 'claude-x' }, llm)).toBeInstanceOf(LlmDecisionClient)
  })

  it('with no decision model asks the LLM when there is one, else answers from fixtures', () => {
    expect(createDecisionClient({ GOOGLE_API_KEY: 'g', LLM_MODEL: 'gemini-4-hydrogen' }, llm)).toBeInstanceOf(LlmDecisionClient)
    expect(createDecisionClient({}, llm)).toBeInstanceOf(FixtureDecisionClient)
  })
})
