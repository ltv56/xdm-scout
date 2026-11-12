export type SendDmResult = { conversationId: string; eventId: string }

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

export class XUncertainError extends Error {}

export interface XClient {
  sendDm(recipientId: string, text: string): Promise<SendDmResult>
}

export const X_CLIENT = Symbol('X_CLIENT')
