import { z } from 'zod'
import { DmMessage, SendDmResult, XClient, XNotAcceptingDmError, XRateLimitError, XUncertainError } from './x-client'

const BASE = 'https://api.x.com'
const TIMEOUT_MS = 15_000

const sendResponse = z.object({ data: z.object({ dm_conversation_id: z.string(), dm_event_id: z.string() }) })
const eventsResponse = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().optional(),
        sender_id: z.string(),
        created_at: z.string(),
        dm_conversation_id: z.string(),
        event_type: z.string(),
      }),
    )
    .optional(),
})

export class LiveXClient implements XClient {
  constructor(
    private readonly getSession: () => Promise<{ userId: string; token: string }>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sendDm(recipientId: string, text: string): Promise<SendDmResult> {
    const res = await this.call(`/2/dm_conversations/with/${recipientId}/messages`, 'POST', { text })
    const parsed = sendResponse.parse(await res.json())
    return { conversationId: parsed.data.dm_conversation_id, eventId: parsed.data.dm_event_id }
  }

  async getConversation(recipientId: string, max?: number): Promise<DmMessage[]> {
    const { userId } = await this.getSession()
    const query = new URLSearchParams({
      'dm_event.fields': 'created_at,sender_id,text,dm_conversation_id,event_type',
      event_types: 'MessageCreate',
      ...(max !== undefined && { max_results: String(Math.min(100, Math.max(1, max))) }),
    })
    const res = await this.call(`/2/dm_conversations/with/${recipientId}/dm_events?${query}`, 'GET')
    const parsed = eventsResponse.parse(await res.json())
    return (parsed.data ?? [])
      .filter((e) => e.event_type === 'MessageCreate')
      .map((e) => ({
        conversationId: e.dm_conversation_id,
        eventId: e.id,
        text: e.text ?? '',
        fromMe: e.sender_id === userId,
        createdAt: new Date(e.created_at),
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
    let res: Response
    try {
      res = await this.fetchFn(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${(await this.getSession()).token}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new XUncertainError('network error or timeout')
    }
    if (res.ok) return res

    const problem: { type?: string; title?: string; detail?: string } = await res.json().catch(() => ({}))
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-rate-limit-reset'))
      throw new XRateLimitError(new Date(reset ? reset * 1000 : Date.now() + 15 * 60_000))
    }
    if (res.status === 403 && problem.type?.includes('dm-recipient-not-accepting')) throw new XNotAcceptingDmError()
    if (res.status >= 500) throw new XUncertainError(`X returned ${res.status}`)
    throw new Error(`X returned ${res.status}: ${problem.title ?? ''} ${problem.detail ?? ''}`.trim())
  }
}
