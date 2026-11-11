import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DmMessage,
  SendDmResult,
  XClient,
  XNotAcceptingDmError,
  XRateLimitError,
  XProfile,
  XUncertainError,
} from './x-client'

export type FakeSendOutcome = 'ok' | 'not-accepting' | 'rate-limit' | 'timeout-delivered' | 'timeout-undelivered'

export class FakeXClient implements XClient {
  nextSend: FakeSendOutcome = 'ok'
  retryAt = new Date(Date.now() + 15 * 60_000)
  sendCalls = 0
  lookupCalls = 0
  conversationError: Error | null = null
  readonly sent: { recipientId: string; text: string }[] = []
  readonly conversationReads: { recipientId: string; max?: number }[] = []
  private readonly messages: (DmMessage & { recipientId: string; seq: number })[] = []
  private readonly profiles = new Map<string, XProfile>()
  private counter = 0

  async sendDm(recipientId: string, text: string): Promise<SendDmResult> {
    this.sendCalls += 1
    switch (this.nextSend) {
      case 'not-accepting':
        throw new XNotAcceptingDmError()
      case 'rate-limit':
        throw new XRateLimitError(this.retryAt)
      case 'timeout-undelivered':
        throw new XUncertainError('timeout')
      case 'timeout-delivered':
        this.record(recipientId, text, true, new Date())
        throw new XUncertainError('timeout')
      case 'ok': {
        const message = this.record(recipientId, text, true, new Date())
        this.sent.push({ recipientId, text })
        return { conversationId: message.conversationId, eventId: message.eventId }
      }
    }
  }

  async getConversation(recipientId: string, max?: number): Promise<DmMessage[]> {
    this.conversationReads.push({ recipientId, max })
    if (this.conversationError) throw this.conversationError
    const newestFirst = this.messages
      .filter((m) => m.recipientId === recipientId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq)
    return newestFirst.slice(0, max ?? newestFirst.length)
  }

  static fromFixtures(file = join(process.cwd(), '../../fixtures/profiles.json')) {
    const client = new FakeXClient()
    for (const p of JSON.parse(readFileSync(file, 'utf8')) as (Partial<XProfile> & Pick<XProfile, 'id' | 'handle'>)[]) {
      client.addProfile(p)
    }
    return client
  }

  addProfile(p: Partial<XProfile> & Pick<XProfile, 'id' | 'handle'>) {
    this.profiles.set(p.handle.toLowerCase(), {
      name: p.handle,
      bio: '',
      followers: 0,
      isProtected: false,
      orgType: null,
      receivesYourDm: false,
      ...p,
    })
  }

  async lookupUsers(handles: string[]): Promise<XProfile[]> {
    this.lookupCalls += 1
    return handles.flatMap((h) => this.profiles.get(h.toLowerCase()) ?? [])
  }

  priorMessage(recipientId: string, text: string, createdAt = new Date(0)) {
    return this.record(recipientId, text, false, createdAt)
  }

  deliverSilently(recipientId: string, text: string, createdAt: Date) {
    this.record(recipientId, text, true, createdAt)
  }

  private record(recipientId: string, text: string, fromMe: boolean, createdAt: Date) {
    this.counter += 1
    const message = { recipientId, conversationId: `${'1'.repeat(19)}-${recipientId.padStart(19, '0')}`, eventId: `e-${this.counter}`, text, fromMe, createdAt, seq: this.counter }
    this.messages.push(message)
    return message
  }
}
