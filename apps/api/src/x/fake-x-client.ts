import {
  DmMessage,
  SendDmResult,
  XClient,
  XNotAcceptingDmError,
  XRateLimitError,
  XUncertainError,
} from './x-client'

export type FakeSendOutcome = 'ok' | 'not-accepting' | 'rate-limit' | 'timeout-delivered' | 'timeout-undelivered'

export class FakeXClient implements XClient {
  nextSend: FakeSendOutcome = 'ok'
  retryAt = new Date(Date.now() + 15 * 60_000)
  sendCalls = 0
  conversationError: Error | null = null
  readonly sent: { recipientId: string; text: string }[] = []
  private readonly messages: (DmMessage & { recipientId: string })[] = []
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

  async getConversation(recipientId: string): Promise<DmMessage[]> {
    if (this.conversationError) throw this.conversationError
    return this.messages.filter((m) => m.recipientId === recipientId)
  }

  priorMessage(recipientId: string, text: string) {
    this.record(recipientId, text, false, new Date(0))
  }

  deliverSilently(recipientId: string, text: string, createdAt: Date) {
    this.record(recipientId, text, true, createdAt)
  }

  private record(recipientId: string, text: string, fromMe: boolean, createdAt: Date) {
    this.counter += 1
    const message = { recipientId, conversationId: `${'1'.repeat(19)}-${recipientId.padStart(19, '0')}`, eventId: `e-${this.counter}`, text, fromMe, createdAt }
    this.messages.push(message)
    return message
  }
}
