import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Contact, DoNotContact, SendAttempt, SenderAccount, XUser } from '../sending/entities'
import { createTestDataSource } from '../test/db'
import { FakeXClient } from '../x/fake-x-client'
import { Campaign, Prospect, XPost } from './entities'
import { DiscoveryService } from './discovery.service'

let ds: DataSource
let x: FakeXClient
let discovery: DiscoveryService

const now = new Date('2026-11-12T10:00:00Z')
const DAY = 86_400_000

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  discovery = new DiscoveryService(ds, x)
  x.addProfile({ id: '1', handle: 'alice', name: 'Alice', bio: 'Building robotics foundation models', followers: 900 })
  x.addProfile({ id: '2', handle: 'bob', name: 'Bob', bio: 'LLM agents and developer tools', followers: 50 })
  x.addProfile({ id: '3', handle: 'acme', name: 'Acme', bio: 'Robotics platform for everyone', followers: 9000, orgType: 'business' })
  x.addProfile({ id: '4', handle: 'locked', name: 'L', bio: 'robotics researcher', followers: 10, isProtected: true })
  x.addProfile({ id: '5', handle: 'chef', name: 'Chef', bio: 'I cook pasta', followers: 10 })
  x.addProfile({ id: '6', handle: 'stopped', name: 'S', bio: 'robotics founder', followers: 10 })
  x.addProfile({ id: '7', handle: 'talked', name: 'T', bio: 'robotics founder', followers: 10 })
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

const newCampaign = (handles: string[]) =>
  ds.getRepository(Campaign).save({ name: 'c', keywords: ['robotics', 'llm', 'ai'], handles })

describe('discovery from a handle list', () => {
  it('dedupes handles and keeps only people who pass the rules', async () => {
    await ds.getRepository(DoNotContact).save({ xUserId: '6', reason: 'stop', source: 'reply' })
    await ds.getRepository(SenderAccount).save({ id: 1, xUserId: '100', handle: 'a' })
    await ds.getRepository(XUser).save({ xUserId: '7', handle: 'talked' })
    const contact = await ds.getRepository(Contact).save({ senderAccountId: 1, xUserId: '7' })
    await ds.getRepository(SendAttempt).save({ contactId: contact.id, draftId: 1, status: 'sent', contentHash: 'h'.repeat(64) })
    const campaign = await newCampaign(['Alice', 'alice', 'bob', 'acme', 'locked', 'chef', 'stopped', 'talked'])

    const result = await discovery.run(campaign.id, now)

    const prospects = await ds.getRepository(Prospect).find({ order: { xUserId: 'ASC' } })
    expect(prospects.map((p) => p.xUserId)).toEqual(['1', '2'])
    expect(result.added).toBe(2)
    expect(Object.fromEntries(result.skipped.map((s) => [s.handle, s.reason]))).toEqual({
      acme: 'organization',
      locked: 'protected',
      chef: 'off-topic',
      stopped: 'do-not-contact',
      talked: 'already-contacted',
    })
  })

  it('does not fetch a profile again while it is fresh, and fetches it once it is older than 7 days', async () => {
    const campaign = await newCampaign(['alice', 'bob'])
    await discovery.run(campaign.id, now)
    expect(x.lookupCalls).toBe(1)

    await discovery.run(campaign.id, new Date(now.getTime() + 6 * DAY))
    expect(x.lookupCalls).toBe(1)

    await discovery.run(campaign.id, new Date(now.getTime() + 8 * DAY))
    expect(x.lookupCalls).toBe(2)
    expect(await ds.getRepository(Prospect).count()).toBe(2)
  })

  it('reads posts again when the stored text was cleared after scoring', async () => {
    x.addPosts('1', [{ id: 'p1', userId: '1', text: 'shipped a robot arm', createdAt: new Date(now.getTime() - DAY) }])
    await discovery.run((await newCampaign(['alice'])).id, now)
    await ds.getRepository(XPost).update({ xUserId: '1' }, { text: '' })

    await discovery.run((await newCampaign(['alice'])).id, now)

    expect((await ds.getRepository(XPost).findOneByOrFail({ postId: 'p1' })).text).toBe('shipped a robot arm')
  })

  it('reports handles X does not know', async () => {
    const campaign = await newCampaign(['alice', 'ghost'])
    const result = await discovery.run(campaign.id, now)
    expect(result.skipped).toEqual([{ handle: 'ghost', reason: 'not-found' }])
    expect(result.added).toBe(1)
  })
})
