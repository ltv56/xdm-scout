import 'reflect-metadata'
import { randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SenderAccount } from '../sending/entities'
import { createTestDataSource } from '../test/db'
import { AuthService } from './auth.service'

let ds: DataSource
let service: AuthService
let calls: { url: string; body: string }[]
let tokenResponses: Record<string, unknown>[]

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(async () => {
  ds = await createTestDataSource()
  calls = []
  tokenResponses = [
    { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 7200, scope: 'dm.read dm.write' },
    { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 7200, scope: 'dm.read dm.write' },
  ]
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    if (String(url).endsWith('/2/oauth2/token')) return json(200, tokenResponses.shift())
    if (String(url).endsWith('/2/users/me')) return json(200, { data: { id: '100', username: 'leviath' } })
    return json(404, {})
  }
  service = new AuthService(ds, {
    clientId: 'cid',
    clientSecret: 'csecret',
    redirectUri: 'http://localhost:3000/api/auth/x/callback',
    tokenKey: randomBytes(32).toString('base64'),
    fetch: fetchFn as typeof fetch,
  })
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

async function connect() {
  const url = new URL(service.loginUrl())
  return service.handleCallback('the-code', url.searchParams.get('state') ?? '')
}

describe('AuthService', () => {
  it('builds a PKCE authorize url with the needed scopes', () => {
    const url = new URL(service.loginUrl())
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('dm.read dm.write tweet.read users.read follows.read offline.access')
    expect(url.searchParams.get('client_id')).toBe('cid')
  })

  it('stores the connected account with encrypted tokens', async () => {
    await connect()
    const account = await ds.getRepository(SenderAccount).findOneByOrFail({ xUserId: '100' })
    expect(account.handle).toBe('leviath')
    expect(account.accessTokenEnc).toBeTruthy()
    expect(account.accessTokenEnc).not.toContain('access-1')
    expect(account.refreshTokenEnc).not.toContain('refresh-1')
    const exchange = calls.find((c) => c.url.endsWith('/2/oauth2/token'))
    expect(exchange?.body).toContain('code_verifier=')
  })

  it('rejects a callback with an unknown state', async () => {
    await expect(service.handleCallback('code', 'nope')).rejects.toThrow('state')
  })

  it('a state can be used once', async () => {
    const state = new URL(service.loginUrl()).searchParams.get('state') ?? ''
    await service.handleCallback('code', state)
    await expect(service.handleCallback('code', state)).rejects.toThrow('state')
  })

  it('returns the stored token while it is fresh', async () => {
    await connect()
    const session = await service.session()
    expect(session).toEqual({ userId: '100', token: 'access-1' })
    expect(calls.filter((c) => c.url.endsWith('/2/oauth2/token'))).toHaveLength(1)
  })

  it('refreshes an expiring token and stores the new pair', async () => {
    await connect()
    await ds.getRepository(SenderAccount).update({ xUserId: '100' }, { tokenExpiresAt: new Date(Date.now() + 30_000) })
    const session = await service.session()
    expect(session.token).toBe('access-2')
    const refresh = calls.filter((c) => c.url.endsWith('/2/oauth2/token'))[1]
    expect(refresh.body).toContain('grant_type=refresh_token')
    expect(refresh.body).toContain('refresh_token=refresh-1')
    expect((await service.session()).token).toBe('access-2')
  })

  it('two callers refreshing at once (api and worker) make one refresh call and share the new token', async () => {
    await connect()
    await ds.getRepository(SenderAccount).update({ xUserId: '100' }, { tokenExpiresAt: new Date(Date.now() + 30_000) })
    const [a, b] = await Promise.all([service.session(), service.session()])
    expect([a.token, b.token]).toEqual(['access-2', 'access-2'])
    expect(calls.filter((c) => c.body.includes('grant_type=refresh_token'))).toHaveLength(1)
  })

  it('fails clearly when no account is connected', async () => {
    await expect(service.session()).rejects.toThrow('No X account connected')
  })

  it('connects one made-up sender account for fake mode without calling X', async () => {
    await service.connectFake()
    await service.connectFake()
    const rows = await ds.getRepository(SenderAccount).find()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ handle: 'sandbox_sender', accessTokenEnc: null })
    expect(calls).toHaveLength(0)
  })
})
