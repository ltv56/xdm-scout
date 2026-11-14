import 'reflect-metadata'
import { randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { AuthService } from '../auth/auth.service'
import { SenderAccount } from '../sending/entities'
import { createTestDataSource } from '../test/db'
import { seedDraft, sha } from '../test/seed'
import { PreflightService, recordHeartbeat } from './preflight.service'
import type { PreflightRow } from './contract'

let ds: DataSource
let auth: AuthService

const env = (vars: Record<string, string>) => ({ get: (k: string, d = '') => vars[k] ?? d })
const make = (vars: Record<string, string> = {}) => new PreflightService(ds, auth, env(vars))
const row = (rows: PreflightRow[], id: string) => rows.find((r) => r.id === id) as PreflightRow
const NOW = new Date('2026-11-14T12:00:00Z')

beforeEach(async () => {
  ds = await createTestDataSource()
  auth = new AuthService(ds, { clientId: 'cid', clientSecret: 's', redirectUri: 'http://x/cb', tokenKey: randomBytes(32).toString('base64') })
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('PreflightService.run (what the operator sees)', () => {
  it('an empty sandbox asks for an X account and shows nothing technical', async () => {
    const rows = await make().run()
    expect(rows.map((r) => r.id)).toEqual(['x_account', 'send_dm', 'passcode'])
    expect(row(rows, 'x_account')).toMatchObject({ status: 'fail' })
    expect(row(rows, 'x_account').fix).toContain('Profile')
  })

  it('x account is ok once the sender is connected', async () => {
    await auth.connectFake()
    expect(row(await make().run(), 'x_account').status).toBe('ok')
  })

  it('Send DM stays unverified until an API send went through', async () => {
    expect(row(await make().run(), 'send_dm')).toMatchObject({ status: 'warn', detail: 'Not verified until the first send' })
    const draft = await seedDraft(ds, '200', 'Hi there')
    await ds.query("INSERT INTO send_attempts (contactId, draftId, route, status, contentHash, createdAt, updatedAt) VALUES (?, ?, 'api', 'sent', ?, NOW(), NOW())", [draft.contactId, draft.id, sha('Hi there')])
    expect(row(await make().run(), 'send_dm').status).toBe('ok')
  })

  it('live mode flags a token without every scope', async () => {
    await ds.getRepository(SenderAccount).save({ xUserId: '100', handle: 'leviath', accessTokenEnc: 'a', refreshTokenEnc: 'r', tokenExpiresAt: new Date(NOW.getTime() + 3_600_000), scope: 'dm.read' })
    const r = row(await make({ X_MODE: 'live' }).run(), 'x_account')
    expect(r.status).toBe('fail')
    expect(r.fix).toContain('dm.write')
  })
})

describe('PreflightService.details (for whoever installed it)', () => {
  it('a worker that never beat is a failure, a recent beat is ok', async () => {
    expect(row(await make().details(NOW), 'worker').status).toBe('fail')
    await recordHeartbeat(ds, new Date(NOW.getTime() - 20_000))
    expect(row(await make().details(NOW), 'worker').status).toBe('ok')
    await recordHeartbeat(ds, new Date(NOW.getTime() - 5 * 60_000))
    expect(row(await make().details(NOW), 'worker').status).toBe('fail')
  })

  it('reads the database, mode and the models', async () => {
    const rows = await make({ LLM_MODEL: 'gpt-5-nano' }).details(NOW)
    expect(row(rows, 'database').status).toBe('ok')
    expect(row(rows, 'mode').detail).toBe('Sandbox')
    expect(row(rows, 'llm')).toMatchObject({ status: 'info', detail: 'gpt-5-nano' })
    expect(row(rows, 'decision').detail).toBe('Built-in fallback')
  })

  it('live mode needs the app credentials and a token key', async () => {
    const rows = await make({ X_MODE: 'live' }).details(NOW)
    expect(row(rows, 'x_app')).toMatchObject({ status: 'fail' })
    expect(row(rows, 'x_app').detail).toContain('X_CLIENT_ID')
    const set = await make({ X_MODE: 'live', X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b', TOKEN_KEY: 'c' }).details(NOW)
    expect(row(set, 'x_app').status).toBe('ok')
  })
})
