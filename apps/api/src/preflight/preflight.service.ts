import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { AuthService } from '../auth/auth.service'
import { Setting } from '../setting.entity'
import { SendAttempt } from '../sending/entities'
import type { PreflightRow } from './contract'

const BEAT_KEY = 'worker.lastBeatAt'
const BEAT_FRESH_MS = 60_000

type Env = { get(key: string, fallback?: string): string | undefined }

export async function recordHeartbeat(ds: DataSource, now: Date) {
  await ds.getRepository(Setting).save({ key: BEAT_KEY, value: now.toISOString() })
}

// Reads local state only: no call to X or to a language model.
@Injectable()
export class PreflightService {
  constructor(
    private readonly ds: DataSource,
    private readonly auth: AuthService,
    private readonly config: Env,
  ) {}

  // What the operator can fix themselves.
  async run(): Promise<PreflightRow[]> {
    const mode = this.mode()
    return [
      await this.xAccount(mode),
      await this.sendDm(),
      { id: 'passcode', label: 'Chat passcode', status: 'info', detail: 'Cannot be checked through the API', fix: 'Set a passcode for X Chat on the sending account, or the Open in X link has no box to type in.' },
    ]
  }

  // For whoever installed it (curl); the UI does not show these.
  async details(now = new Date()): Promise<PreflightRow[]> {
    const mode = this.mode()
    return [
      await this.database(),
      await this.worker(now),
      { id: 'mode', label: 'Mode', status: 'info', detail: mode === 'live' ? 'Live' : 'Sandbox' },
      this.xApp(mode),
      this.llm(),
      this.decision(),
    ]
  }

  private mode() {
    return this.config.get('X_MODE', 'fake') ?? 'fake'
  }

  private async database(): Promise<PreflightRow> {
    const base = { id: 'database', label: 'Database' }
    try {
      await this.ds.query('SELECT 1 FROM sender_accounts LIMIT 1')
      return { ...base, status: 'ok', detail: 'Connected' }
    } catch {
      return { ...base, status: 'fail', detail: 'Cannot read the tables', fix: 'Start the database and run the migrations (docs/testing.md).' }
    }
  }

  private xApp(mode: string): PreflightRow {
    const base = { id: 'x_app', label: 'X app credentials' }
    if (mode !== 'live') return { ...base, status: 'info', detail: 'Not needed in the sandbox' }
    const missing = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'TOKEN_KEY'].filter((k) => !this.config.get(k, ''))
    if (!missing.length) return { ...base, status: 'ok', detail: 'Client ID, secret and token key are set' }
    return { ...base, status: 'fail', detail: `Missing ${missing.join(', ')}`, fix: 'Add them to .env and restart (docs/x-app-setup.md).' }
  }

  private async xAccount(mode: string): Promise<PreflightRow> {
    const base = { id: 'x_account', label: 'X account' }
    const s = await this.auth.status(mode)
    if (!s.connected) return { ...base, status: 'fail', detail: 'Not connected', fix: 'Open Profile and connect the X account.' }
    if (s.missingScopes.length) return { ...base, status: 'fail', detail: `@${s.handle} is missing permissions`, fix: `Reconnect on Profile to grant: ${s.missingScopes.join(', ')}.` }
    if (s.tokenExpiresAt && s.tokenExpiresAt.getTime() < Date.now()) return { ...base, status: 'warn', detail: `@${s.handle}, access token expired`, fix: 'It renews itself on the next send; reconnect on Profile if sends fail.' }
    return { ...base, status: 'ok', detail: `@${s.handle}` }
  }

  // X has no way to check the right to send without sending, so this stays amber until one API send worked.
  private async sendDm(): Promise<PreflightRow> {
    const base = { id: 'send_dm', label: 'Send DM' }
    const sent = await this.ds.getRepository(SendAttempt).count({ where: { route: 'api', status: 'sent' } })
    if (sent) return { ...base, status: 'ok', detail: 'A message went out through the API' }
    return { ...base, status: 'warn', detail: 'Not verified until the first send', fix: 'Approve one reply to someone who messaged first, from an account you control.' }
  }

  private llm(): PreflightRow {
    const base = { id: 'llm', label: 'Language model' }
    const model = this.config.get('LLM_MODEL', '')
    if (model) return { ...base, status: 'info', detail: model }
    return { ...base, status: 'warn', detail: 'Not set: drafts are fixed templates', fix: 'Set LLM_MODEL and the matching API key in .env.' }
  }

  private decision(): PreflightRow {
    return { id: 'decision', label: 'Decision model', status: 'info', detail: this.config.get('DECISION_MODEL', '') || 'Built-in fallback' }
  }

  private async worker(now: Date): Promise<PreflightRow> {
    const base = { id: 'worker', label: 'Worker' }
    const beat = await this.ds.getRepository(Setting).findOneBy({ key: BEAT_KEY })
    const at = typeof beat?.value === 'string' ? new Date(beat.value) : null
    if (at && now.getTime() - at.getTime() <= BEAT_FRESH_MS) return { ...base, status: 'ok', detail: 'Running' }
    return { ...base, status: 'fail', detail: at ? `Last seen ${at.toISOString()}` : 'Never seen', fix: 'Start the worker (node dist/worker-main.js). Nothing is sent or read without it.' }
  }
}
