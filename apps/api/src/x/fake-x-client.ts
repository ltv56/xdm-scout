import { SendDmResult, XClient, XNotAcceptingDmError } from './x-client'

export type FakeSendOutcome = 'ok' | 'not-accepting'

export class FakeXClient implements XClient {
  nextSend: FakeSendOutcome = 'ok'
  readonly sent: { recipientId: string; text: string }[] = []
  private counter = 0

  async sendDm(recipientId: string, text: string): Promise<SendDmResult> {
    if (this.nextSend === 'not-accepting') throw new XNotAcceptingDmError()
    this.sent.push({ recipientId, text })
    this.counter += 1
    return { conversationId: `c-${recipientId}`, eventId: `e-${this.counter}` }
  }
}
