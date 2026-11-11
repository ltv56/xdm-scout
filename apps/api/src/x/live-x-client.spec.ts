import { describe, expect, it } from 'vitest'
import { LiveXClient } from './live-x-client'
import { XNotAcceptingDmError, XRateLimitError, XUncertainError } from './x-client'

type Call = { url: string; init: RequestInit }

function clientWith(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return respond(call)
  }
  const client = new LiveXClient(async () => ({ userId: '100', token: 'tok' }), fetchFn as typeof fetch)
  return { client, calls }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('LiveXClient.sendDm', () => {
  it('posts to the with/<id> endpoint with a bearer token and returns ids', async () => {
    const { client, calls } = clientWith(() =>
      json(201, { data: { dm_conversation_id: '100-200', dm_event_id: '555' } }),
    )
    const result = await client.sendDm('200', 'Hi')
    expect(result).toEqual({ conversationId: '100-200', eventId: '555' })
    expect(calls[0].url).toBe('https://api.x.com/2/dm_conversations/with/200/messages')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: 'Hi' })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('maps dm-recipient-not-accepting to XNotAcceptingDmError', async () => {
    const { client } = clientWith(() =>
      json(403, { type: 'https://api.x.com/2/problems/dm-recipient-not-accepting', title: 'Forbidden' }),
    )
    await expect(client.sendDm('200', 'Hi')).rejects.toBeInstanceOf(XNotAcceptingDmError)
  })

  it('maps 429 to XRateLimitError using the reset header', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const { client } = clientWith(() => json(429, { title: 'Too Many Requests' }, { 'x-rate-limit-reset': String(reset) }))
    const err = await client.sendDm('200', 'Hi').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(XRateLimitError)
    expect((err as XRateLimitError).retryAt.getTime()).toBe(reset * 1000)
  })

  it('maps 5xx to XUncertainError', async () => {
    const { client } = clientWith(() => json(503, {}))
    await expect(client.sendDm('200', 'Hi')).rejects.toBeInstanceOf(XUncertainError)
  })

  it('maps a network failure to XUncertainError', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('fetch failed')
    })
    await expect(client.sendDm('200', 'Hi')).rejects.toBeInstanceOf(XUncertainError)
  })

  it('treats other 4xx as a definite failure, not uncertain', async () => {
    const { client } = clientWith(() => json(400, { title: 'Invalid Request' }))
    const err = await client.sendDm('200', 'Hi').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(XUncertainError)
  })
})

describe('LiveXClient.getConversation', () => {
  it('maps events and marks messages from the sender account as fromMe', async () => {
    const { client, calls } = clientWith(() =>
      json(200, {
        data: [
          { id: '2', text: 'reply', sender_id: '200', created_at: '2026-11-12T10:01:00.000Z', dm_conversation_id: '100-200', event_type: 'MessageCreate' },
          { id: '1', text: 'Hi', sender_id: '100', created_at: '2026-11-12T10:00:00.000Z', dm_conversation_id: '100-200', event_type: 'MessageCreate' },
        ],
      }),
    )
    const messages = await client.getConversation('200')
    expect(messages).toEqual([
      { conversationId: '100-200', eventId: '2', text: 'reply', fromMe: false, createdAt: new Date('2026-11-12T10:01:00.000Z') },
      { conversationId: '100-200', eventId: '1', text: 'Hi', fromMe: true, createdAt: new Date('2026-11-12T10:00:00.000Z') },
    ])
    expect(calls[0].url).toContain('/2/dm_conversations/with/200/dm_events')
    expect(calls[0].url).toContain('dm_event.fields=')
  })

  it('asks X for only the latest events when a max is given', async () => {
    const { client, calls } = clientWith(() => json(200, { meta: { result_count: 0 } }))
    await client.getConversation('200', 1)
    expect(new URL(calls[0].url).searchParams.get('max_results')).toBe('1')
  })

  it('returns an empty list when there is no conversation yet', async () => {
    const { client } = clientWith(() => json(200, { meta: { result_count: 0 } }))
    expect(await client.getConversation('200')).toEqual([])
  })

  it('maps a read timeout to XUncertainError', async () => {
    const { client } = clientWith(() => json(500, {}))
    await expect(client.getConversation('200')).rejects.toBeInstanceOf(XUncertainError)
  })
})
