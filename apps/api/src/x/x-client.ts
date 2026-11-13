export type SendDmResult = { conversationId: string; eventId: string }

export type DmMessage = {
  conversationId: string
  eventId: string
  text: string
  fromMe: boolean
  createdAt: Date
}

export type XProfile = {
  id: string
  handle: string
  name: string
  bio: string
  followers: number
  isProtected: boolean
  orgType: 'business' | 'government' | null
  receivesYourDm: boolean
}

// lang is X's own language guess for the post ("und" when it has none).
export type XPost = { id: string; userId: string; text: string; createdAt: Date; lang?: string }

export class XRateLimitError extends Error {
  constructor(readonly retryAt: Date) {
    super('rate limited')
  }
}

export class XNotAcceptingDmError extends Error {
  constructor() {
    super("X says this person doesn't accept DMs from this account.")
  }
}

// Timeout, network or 5xx: we do not know whether X delivered the message.
export class XUncertainError extends Error {}

export interface XClient {
  sendDm(recipientId: string, text: string): Promise<SendDmResult>
  // Newest first. X bills each event read, so callers pass the smallest max they need.
  getConversation(recipientId: string, max?: number): Promise<DmMessage[]>
  lookupUsers(handles: string[]): Promise<XProfile[]>
  getRecentPosts(userId: string, max: number): Promise<XPost[]>
  getFollowing(userId: string, max: number): Promise<XProfile[]>
  // Recent posts (7 days) matching the query, with their authors.
  searchRecent(query: string, max: number): Promise<{ posts: XPost[]; authors: XProfile[] }>
}

export const X_CLIENT = Symbol('X_CLIENT')
