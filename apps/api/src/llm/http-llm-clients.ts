import { LlmClient, LlmRequest } from './llm-client'

const TIMEOUT_MS = 60_000

// Models sometimes wrap JSON in a code fence; anything unparsable becomes null so the caller can retry.
function parseJson(text: string): unknown {
  const body = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function post(fetchFn: typeof fetch, url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`LLM request failed with ${res.status}`)
  return res.json()
}

export class OpenAiCompatibleLlmClient implements LlmClient {
  constructor(
    private readonly cfg: { baseUrl: string; apiKey: string; model: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async completeJson(req: LlmRequest): Promise<unknown> {
    const data = (await post(
      this.fetchFn,
      `${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      { Authorization: `Bearer ${this.cfg.apiKey}` },
      {
        model: this.cfg.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      },
    )) as { choices?: { message?: { content?: string } }[] }
    return parseJson(data.choices?.[0]?.message?.content ?? '')
  }
}

export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly cfg: { apiKey: string; model: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async completeJson(req: LlmRequest): Promise<unknown> {
    const data = (await post(
      this.fetchFn,
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
      { model: this.cfg.model, max_tokens: 2000, temperature: 0, system: req.system, messages: [{ role: 'user', content: req.user }] },
    )) as { content?: { type: string; text?: string }[] }
    return parseJson(data.content?.find((c) => c.type === 'text')?.text ?? '')
  }
}
