import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import { z } from 'zod'
import { SenderAccount } from '../sending/entities'
import { decryptToken, encryptToken } from './token-crypto'

export const X_AUTH_CONFIG = Symbol('X_AUTH_CONFIG')

export type XAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  tokenKey: string
  fetch?: typeof fetch
}

export type XSession = { userId: string; token: string }

const SCOPE = 'dm.read dm.write tweet.read users.read follows.read offline.access'
const REFRESH_MARGIN_MS = 120_000

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
})
const meResponse = z.object({ data: z.object({ id: z.string(), username: z.string() }) })

@Injectable()
export class AuthService {
  private readonly pending = new Map<string, string>()

  constructor(
    private readonly ds: DataSource,
    @Inject(X_AUTH_CONFIG) private readonly cfg: XAuthConfig,
  ) {}

  loginUrl(): string {
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(16).toString('hex')
    this.pending.set(state, verifier)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      scope: SCOPE,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })
    return `https://x.com/i/oauth2/authorize?${params}`
  }

  async handleCallback(code: string, state: string): Promise<void> {
    const verifier = this.pending.get(state)
    if (!verifier) throw new Error('Unknown or already used OAuth state')
    this.pending.delete(state)

    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.redirectUri,
      code_verifier: verifier,
      client_id: this.cfg.clientId,
    })
    const me = await this.fetchMe(tokens.access_token)
    const repo = this.ds.getRepository(SenderAccount)
    const account = (await repo.findOneBy({ xUserId: me.id })) ?? repo.create({ xUserId: me.id })
    account.handle = me.username
    this.applyTokens(account, tokens)
    await repo.save(account)
  }

  async session(now = new Date()): Promise<XSession> {
    const repo = this.ds.getRepository(SenderAccount)
    const account = await repo.findOne({ where: {}, order: { id: 'ASC' } })
    if (!account?.accessTokenEnc || !account.refreshTokenEnc) throw new Error('No X account connected')

    const key = this.cfg.tokenKey
    const expiresAt = account.tokenExpiresAt?.getTime() ?? 0
    if (expiresAt - now.getTime() > REFRESH_MARGIN_MS) {
      return { userId: account.xUserId, token: decryptToken(account.accessTokenEnc, key) }
    }
    const tokens = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: decryptToken(account.refreshTokenEnc, key),
      client_id: this.cfg.clientId,
    })
    this.applyTokens(account, tokens)
    await repo.save(account)
    return { userId: account.xUserId, token: tokens.access_token }
  }

  private applyTokens(account: SenderAccount, tokens: z.infer<typeof tokenResponse>) {
    account.accessTokenEnc = encryptToken(tokens.access_token, this.cfg.tokenKey)
    account.refreshTokenEnc = encryptToken(tokens.refresh_token, this.cfg.tokenKey)
    account.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    account.scope = tokens.scope ?? null
  }

  private async tokenRequest(params: Record<string, string>) {
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')
    const res = await (this.cfg.fetch ?? fetch)('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams(params),
    })
    if (!res.ok) throw new Error(`X token endpoint returned ${res.status}`)
    return tokenResponse.parse(await res.json())
  }

  private async fetchMe(accessToken: string) {
    const res = await (this.cfg.fetch ?? fetch)('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`X users/me returned ${res.status}`)
    return meResponse.parse(await res.json()).data
  }
}
