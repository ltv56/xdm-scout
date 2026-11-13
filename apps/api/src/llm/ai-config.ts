import { DecisionClient, FixtureDecisionClient } from '../decisions/decision-client'
import { GeminiDecisionClient } from '../decisions/gemini-decision-client'
import { LlmDecisionClient } from '../decisions/llm-decision-client'
import { SystemOneDecisionClient } from '../decisions/system-one-decision-client'
import { cannedHandler, FakeLlmClient } from './fake-llm-client'
import { AnthropicLlmClient, OpenAiCompatibleLlmClient } from './http-llm-clients'
import { LlmClient } from './llm-client'

export type Keys = { google?: string; openRouter?: string; anthropic?: string; openai?: string }
export type TextRoute = { provider: 'anthropic' | 'openai' | 'google' | 'openrouter'; model: string }
export type DecisionRoute = { kind: 'google-decision'; model: string } | { kind: 'system-one'; model: string } | { kind: 'llm'; route: TextRoute }

const BASE_URL = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
}

const KEY_NAME = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY', openrouter: 'OPEN_ROUTER_API_KEY' }

// The maker's own key first, then OpenRouter. A name nobody recognises goes to OpenRouter and fails there if it is wrong.
export function routeText(model: string, keys: Keys): TextRoute | null {
  if (!model) return null
  const maker = /^claude/i.test(model) ? 'anthropic' : /^(gpt|o\d)/i.test(model) ? 'openai' : /^gemini/i.test(model) ? 'google' : null
  if (maker && keys[maker]) return { provider: maker, model }
  if (maker && keys.openRouter) return { provider: 'openrouter', model: `${maker}/${model}` }
  if (maker) throw new Error(`No key for ${model}: set ${KEY_NAME[maker]} or ${KEY_NAME.openrouter}`)
  if (keys.openRouter) return { provider: 'openrouter', model }
  throw new Error(`Cannot tell which provider serves "${model}": set ${KEY_NAME.openrouter} to try it there`)
}

export function routeDecision(model: string, keys: Keys): DecisionRoute | null {
  if (!model) return null
  if (/^gemini-decision/i.test(model)) {
    if (!keys.google) throw new Error(`No key for ${model}: set ${KEY_NAME.google}`)
    return { kind: 'google-decision', model }
  }
  if (/jev|decid|decision|drex/i.test(model)) {
    if (!keys.openRouter) throw new Error(`No key for ${model}: set ${KEY_NAME.openrouter}`)
    return { kind: 'system-one', model }
  }
  const route = routeText(model, keys)
  return route && { kind: 'llm', route }
}

type Env = Record<string, string | undefined>

const keysOf = (env: Env): Keys => ({ google: env.GOOGLE_API_KEY, openRouter: env.OPEN_ROUTER_API_KEY, anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY })

function buildLlm(route: TextRoute, keys: Keys): LlmClient {
  if (route.provider === 'anthropic') return new AnthropicLlmClient({ apiKey: keys.anthropic ?? '', model: route.model })
  const apiKey = (route.provider === 'openai' ? keys.openai : route.provider === 'google' ? keys.google : keys.openRouter) ?? ''
  return new OpenAiCompatibleLlmClient({ apiKey, model: route.model, baseUrl: BASE_URL[route.provider] })
}

// LLM_MODEL empty = the canned client, so the app runs without any key.
export function createLlmClient(env: Env): LlmClient {
  const keys = keysOf(env)
  const route = routeText(env.LLM_MODEL ?? '', keys)
  return route ? buildLlm(route, keys) : new FakeLlmClient(cannedHandler)
}

// DECISION_MODEL empty: ask the LLM if there is one, else answer from fixtures.
export function createDecisionClient(env: Env, llm: LlmClient): DecisionClient {
  const keys = keysOf(env)
  const route = routeDecision(env.DECISION_MODEL ?? '', keys)
  if (!route) return env.LLM_MODEL ? new LlmDecisionClient(llm) : new FixtureDecisionClient()
  if (route.kind === 'google-decision') return new GeminiDecisionClient({ apiKey: keys.google ?? '', model: route.model })
  if (route.kind === 'system-one') return new SystemOneDecisionClient({ apiKey: keys.openRouter ?? '', model: route.model })
  return new LlmDecisionClient(buildLlm(route.route, keys))
}
