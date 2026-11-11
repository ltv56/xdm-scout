import { createHash } from 'node:crypto'
import { DataSource } from 'typeorm'
import { Contact, Draft, SenderAccount, XUser } from '../sending/entities'

export const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export async function seedDraft(ds: DataSource, xUserId = '200', content = 'Hi there', contact: Partial<Contact> = {}) {
  await ds.getRepository(SenderAccount).save({ id: 1, xUserId: '100', handle: 'a' })
  await ds.getRepository(XUser).save({ xUserId, handle: `u${xUserId}` })
  const saved = await ds.getRepository(Contact).save({
    senderAccountId: 1,
    xUserId,
    recipientPermission: 'requested_dm',
    invitationEventId: 'invite-1',
    invitationAt: new Date(Date.now() - 86_400_000),
    ...contact,
  })
  return ds.getRepository(Draft).save({ contactId: saved.id, content })
}
