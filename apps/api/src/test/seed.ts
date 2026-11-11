import { createHash } from 'node:crypto'
import { DataSource } from 'typeorm'
import { Contact, Draft, SenderAccount, XUser } from '../sending/entities'

export const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export async function seedDraft(ds: DataSource, xUserId = '200', content = 'Hi there') {
  await ds.getRepository(SenderAccount).save({ id: 1, xUserId: '100', handle: 'a' })
  await ds.getRepository(XUser).save({ xUserId, handle: `u${xUserId}` })
  const contact = await ds.getRepository(Contact).save({
    senderAccountId: 1,
    xUserId,
    recipientPermission: 'requested_dm',
  })
  return ds.getRepository(Draft).save({ contactId: contact.id, content })
}
