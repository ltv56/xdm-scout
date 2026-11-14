import { z } from 'zod'
import { REPLY_CLASSES } from './reply-class'

// sent_by_hand: the operator said they sent it, the API can't see it. not_confirmed: an API send X never confirmed.
export const checkReason = z.enum(['sent_by_hand', 'not_confirmed'])

const person = { attemptId: z.number(), handle: z.string(), name: z.string().nullable(), text: z.string(), at: z.string() }

export const checkItem = z.object({ ...person, reason: checkReason, openInX: z.string() })
export const deliveredItem = z.object({ ...person, verifiedBy: z.enum(['api', 'operator']), replied: z.boolean() })
// theirText is null when the operator marked a reply they read in an encrypted chat.
export const replyItem = z.object({
  replyId: z.number(),
  handle: z.string(),
  name: z.string().nullable(),
  theirText: z.string().nullable(),
  ourText: z.string(),
  at: z.string(),
  handled: z.boolean(),
  // null: not sorted yet (operator replies have no text to sort).
  replyClass: z.enum(REPLY_CLASSES).nullable(),
  classBy: z.enum(['rule', 'llm', 'operator']).nullable(),
  doNotContact: z.boolean(),
  openInX: z.string(),
})
export const inboxChecks = z.object({ replies: z.array(replyItem), toCheck: z.array(checkItem), delivered: z.array(deliveredItem) })

export const replyClassBody = z.object({ replyClass: z.enum(REPLY_CLASSES) })

export const confirmBody =z.object({ outcome: z.enum(['sent', 'not_sent']) })

export type CheckItem = z.infer<typeof checkItem>
export type DeliveredItem = z.infer<typeof deliveredItem>
export type ReplyItem = z.infer<typeof replyItem>
export type InboxChecks = z.infer<typeof inboxChecks>
export type ConfirmBody = z.infer<typeof confirmBody>
