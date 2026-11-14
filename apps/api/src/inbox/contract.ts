import { z } from 'zod'

// sent_by_hand: the operator said they sent it, the API can't see it. not_confirmed: an API send X never confirmed.
export const checkReason = z.enum(['sent_by_hand', 'not_confirmed'])

const person = { attemptId: z.number(), handle: z.string(), name: z.string().nullable(), text: z.string(), at: z.string() }

export const checkItem = z.object({ ...person, reason: checkReason, openInX: z.string() })
export const deliveredItem = z.object({ ...person, verifiedBy: z.enum(['api', 'operator']) })
export const inboxChecks = z.object({ toCheck: z.array(checkItem), delivered: z.array(deliveredItem) })

export const confirmBody = z.object({ outcome: z.enum(['sent', 'not_sent']) })

export type CheckItem = z.infer<typeof checkItem>
export type DeliveredItem = z.infer<typeof deliveredItem>
export type InboxChecks = z.infer<typeof inboxChecks>
export type ConfirmBody = z.infer<typeof confirmBody>
