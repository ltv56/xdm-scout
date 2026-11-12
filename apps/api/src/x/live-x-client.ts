import { z } from 'zod'
import { DmMessage, SendDmResult, XClient, XPost, XProfile, XNotAcceptingDmError, XRateLimitError, XUncertainError } from './x-client'

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

const usersResponse = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        username: z.string(),
        name: z.string(),
        description: z.string().optional(),
        protected: z.boolean().optional(),
        verified_type: z.string().optional(),
        receives_your_dm: z.boolean().optional(),
        public_metrics: z.object({ followers_count: z.number() }).optional(),
      }),
    )
    .optional(),
  meta: z.object({ next_token: z.string().optional() }).optional(),
})

const USER_FIELDS = 'description,protected,public_metrics,verified_type,receives_your_dm'

function toProfile(u: NonNullable<z.infer<typeof usersResponse>['data']>[number]): XProfile {
  return {
    id: u.id,
    handle: u.username,
    name: u.name,
    bio: u.description ?? '',
    followers: u.public_metrics?.followers_count ?? 0,
    isProtected: u.protected ?? false,
    orgType: u.verified_type === 'business' || u.verified_type === 'government' ? u.verified_type : null,
    receivesYourDm: u.receives_your_dm ?? false,
  }
}

const postsResponse = z.object({
  data: z.array(z.object({ id: z.string(), text: z.string(), created_at: z.string() })).optional(),
})

const searchResponse = z.object({
  data: z.array(z.object({ id: z.string(), text: z.string(), created_at: z.string(), author_id: z.string() })).optional(),
  includes: z.object({ users: usersResponse.shape.data }).optional(),
  meta: z.object({ next_token: z.string().optional() }).optional(),
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

  async getRecentPosts(userId: string, max: number): Promise<XPost[]> {
    const query = new URLSearchParams({
      max_results: String(Math.max(5, max)),
      'tweet.fields': 'created_at',
      exclude: 'retweets',
    })
    const parsed = postsResponse.parse(await (await this.call(`/2/users/${userId}/tweets?${query}`, 'GET')).json())
    return (parsed.data ?? []).slice(0, max).map((p) => ({ id: p.id, userId, text: p.text, createdAt: new Date(p.created_at) }))
  }

  async lookupUsers(handles: string[]): Promise<XProfile[]> {
    const out: XProfile[] = []
    for (let i = 0; i < handles.length; i += 100) {
      const query = new URLSearchParams({ usernames: handles.slice(i, i + 100).join(','), 'user.fields': USER_FIELDS })
      const parsed = usersResponse.parse(await (await this.call(`/2/users/by?${query}`, 'GET')).json())
      out.push(...(parsed.data ?? []).map(toProfile))
    }
    return out
  }

  async searchRecent(query: string, max: number) {
    const posts: XPost[] = []
    const authors = new Map<string, XProfile>()
    let token: string | undefined
    do {
      const params = new URLSearchParams({
        query,
        max_results: String(Math.min(100, Math.max(10, max - posts.length))),
        'tweet.fields': 'created_at,author_id',
        expansions: 'author_id',
        'user.fields': USER_FIELDS,
        ...(token && { next_token: token }),
      })
      const parsed = searchResponse.parse(await (await this.call(`/2/tweets/search/recent?${params}`, 'GET')).json())
      for (const p of parsed.data ?? []) posts.push({ id: p.id, userId: p.author_id, text: p.text, createdAt: new Date(p.created_at) })
      for (const u of parsed.includes?.users ?? []) authors.set(u.id, toProfile(u))
      token = parsed.meta?.next_token
    } while (token && posts.length < max)
    return { posts: posts.slice(0, max), authors: [...authors.values()] }
  }

  // X bills each user returned, so stop paging once max is reached.
  async getFollowing(userId: string, max: number): Promise<XProfile[]> {
    const out: XProfile[] = []
    let token: string | undefined
    do {
      const query = new URLSearchParams({
        max_results: String(Math.min(1000, Math.max(1, max - out.length))),
        'user.fields': USER_FIELDS,
        ...(token && { pagination_token: token }),
      })
      const parsed = usersResponse.parse(await (await this.call(`/2/users/${userId}/following?${query}`, 'GET')).json())
      out.push(...(parsed.data ?? []).map(toProfile))
      token = parsed.meta?.next_token
    } while (token && out.length < max)
    return out.slice(0, max)
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
