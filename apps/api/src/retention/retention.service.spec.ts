import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Prospect, XPost } from '../discovery/entities'
import { Claim, Evidence } from '../fit/entities'
import { Contact, Draft, XUser } from '../sending/entities'
import { createTestDataSource } from '../test/db'
import { RetentionService } from './retention.service'

let ds: DataSource
let retention: RetentionService

const now = new Date('2026-11-20T10:00:00Z')
const DAY = 86_400_000
const ago = (days: number) => new Date(now.getTime() - days * DAY)

beforeEach(async () => {
  ds = await createTestDataSource()
  retention = new RetentionService(ds)
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

async function scoredUser(xUserId: string, fetchedDaysAgo: number) {
  await ds.getRepository(XUser).save({ xUserId, handle: `u${xUserId}`, name: 'N', bio: 'robotics', followers: 10, fetchedAt: ago(fetchedDaysAgo) })
  const prospect = await ds.getRepository(Prospect).save({ campaignId: 1, xUserId, scoredAt: ago(fetchedDaysAgo), openingEvidenceId: `post:${xUserId}a` })
  await ds.getRepository(XPost).save([
    { postId: `${xUserId}a`, xUserId, text: 'shipped a robot arm', postedAt: ago(fetchedDaysAgo + 1), fetchedAt: ago(fetchedDaysAgo) },
    { postId: `${xUserId}b`, xUserId, text: 'lunch', postedAt: ago(fetchedDaysAgo + 2), fetchedAt: ago(fetchedDaysAgo) },
  ])
  const evidence = (id: string, kind: 'bio' | 'post') => ({ id, xUserId, kind, url: `https://x.com/${id}`, excerpt: `text of ${id}`, postedAt: null, fetchedAt: ago(fetchedDaysAgo) })
  await ds.getRepository(Evidence).save([evidence(`bio:${xUserId}`, 'bio'), evidence(`post:${xUserId}a`, 'post'), evidence(`post:${xUserId}b`, 'post'), evidence(`post:${xUserId}c`, 'post')])
  await ds.getRepository(Claim).save({ prospectId: prospect.id, side: 'for', text: 'builds robots', evidenceIds: [`bio:${xUserId}`], status: 'verified' })
}

async function liveDraft(xUserId: string) {
  const contact = await ds.getRepository(Contact).save({ senderAccountId: 1, xUserId })
  await ds.getRepository(Draft).save({ contactId: contact.id, content: 'hi', status: 'pending' })
}

describe('retention sweep', () => {
  it('clears post text once every prospect of that person is scored, keeping id and date', async () => {
    await scoredUser('1', 1)
    await ds.getRepository(XPost).save({ postId: '2a', xUserId: '2', text: 'still needed', postedAt: ago(3), fetchedAt: ago(1) })
    await ds.getRepository(Prospect).save({ campaignId: 1, xUserId: '2', scoredAt: null })

    await retention.sweep(now)

    const posts = await ds.getRepository(XPost).find({ order: { postId: 'ASC' } })
    expect(posts.map((p) => [p.postId, p.text])).toEqual([['1a', ''], ['1b', ''], ['2a', 'still needed']])
    expect(posts[0].postedAt).toEqual(ago(2))
  })

  it('drops post evidence that no claim or opening cites', async () => {
    await scoredUser('1', 1)

    await retention.sweep(now)

    const ids = (await ds.getRepository(Evidence).find({ order: { id: 'ASC' } })).map((e) => e.id)
    expect(ids).toEqual(['bio:1', 'post:1a'])
  })

  it('after 7 days clears profile fields and excerpts of people without a live draft, keeping ids, handle and links', async () => {
    await scoredUser('1', 8)
    await scoredUser('2', 8)
    await liveDraft('2')
    await scoredUser('3', 6)

    await retention.sweep(now)

    const users = await ds.getRepository(XUser).find({ order: { xUserId: 'ASC' } })
    expect(users.map((u) => [u.xUserId, u.handle, u.name, u.bio, u.followers])).toEqual([
      ['1', 'u1', null, null, null],
      ['2', 'u2', 'N', 'robotics', 10],
      ['3', 'u3', 'N', 'robotics', 10],
    ])
    const evidence = await ds.getRepository(Evidence).find({ order: { id: 'ASC' } })
    expect(evidence.map((e) => [e.id, e.excerpt, e.url])).toEqual([
      ['bio:1', '', 'https://x.com/bio:1'],
      ['bio:2', 'text of bio:2', 'https://x.com/bio:2'],
      ['bio:3', 'text of bio:3', 'https://x.com/bio:3'],
      ['post:1a', '', 'https://x.com/post:1a'],
      ['post:2a', 'text of post:2a', 'https://x.com/post:2a'],
      ['post:3a', 'text of post:3a', 'https://x.com/post:3a'],
    ])
  })

  it('keeps data while the draft is approved, and clears it once the draft is skipped', async () => {
    await scoredUser('1', 8)
    await liveDraft('1')
    await ds.getRepository(Draft).update({ status: 'pending' }, { status: 'approved' })
    await retention.sweep(now)
    expect((await ds.getRepository(XUser).findOneByOrFail({ xUserId: '1' })).bio).toBe('robotics')

    await ds.getRepository(Draft).update({ status: 'approved' }, { status: 'skipped' })
    await retention.sweep(now)
    expect((await ds.getRepository(XUser).findOneByOrFail({ xUserId: '1' })).bio).toBeNull()
  })
})
