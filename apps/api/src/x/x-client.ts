export type SendDmResult = { conversationId: string; eventId: string }

export type DmMessage = {
  conversationId: string
  eventId: string
  text: string
  fromMe: boolean
  createdAt: Date
}

export class XRateLimitError extends Error {
  constructor(readonly retryAt: Date) {
    super('rate limited')
  }
}

export class XNotAcceptingDmError extends Error {
  constructor() {
    super('recipient is not accepting DMs')
  }
}

// Timeout, network or 5xx: we do not know whether X delivered the message.
export class XUncertainError extends Error {}

export interface XClient {
  sendDm(recipientId: string, text: string): Promise<SendDmResult>
  getConversation(recipientId: string): Promise<DmMessage[]>
}

export const X_CLIENT = Symbol('X_CLIENT')
