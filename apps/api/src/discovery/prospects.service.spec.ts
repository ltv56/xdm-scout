import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Claim, Evidence } from '../fit/entities'
import { XUser } from '../sending/entities'
import { createTestDataSource } from '../test/db'
import { Campaign, Prospect, XPost } from './entities'
import { ProspectsService } from './prospects.service'

let ds: DataSource

const now = new Date('2026-11-12T10:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

beforeEach(async () => {
  ds = await createTestDataSource()
  await ds.getRepository(Campaign).save({ name: 'c', keywords: ['ai'], handles: [] })
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

async function addProspect(id: string, over: Partial<Prospect> = {}, bio = 'ai builder') {
  await ds.getRepository(XUser).save({ xUserId: id, handle: `u${id}`, name: `User ${id}`, bio, followers: 5 })
  return ds.getRepository(Prospect).save({ campaignId: 1, xUserId: id, ...over })
}

describe('prospects list', () => {
  it('orders by Fit, then by how recent the opening is, and puts unscored people last', async () => {
    await addProspect('1', { fit: 'weak', openingDate: daysAgo(1) })
    await addProspect('2', { fit: 'strong', openingDate: daysAgo(20) })
    await addProspect('3')
    await addProspect('4', { fit: 'strong', openingDate: daysAgo(3) })
    await addProspect('5', { fit: 'possible', openingDate: null })

    const list = await new ProspectsService(ds).list(1, now)
    expect(list.map((p) => p.handle)).toEqual(['u4', 'u2', 'u5', 'u1', 'u3'])
  })

  it('labels opening freshness and attaches claims with their evidence links', async () => {
    const p = await addProspect('1', {
      fit: 'strong',
      openingType: 'launch',
      openingSummary: 'Shipped v1',
      openingEvidenceId: 'post:7',
      openingDate: daysAgo(45),
    })
    await ds.getRepository(Evidence).save({
      id: 'post:7', xUserId: '1', kind: 'post', url: 'https://x.com/u1/status/7', excerpt: 'Shipped v1', postedAt: daysAgo(45), fetchedAt: now,
    })
    await ds.getRepository(Claim).save({ prospectId: p.id, side: 'for', text: 'Shipped a product', evidenceIds: ['post:7'], status: 'verified' })

    const [row] = await new ProspectsService(ds).list(1, now)
    expect(row.opening).toMatchObject({ type: 'launch', summary: 'Shipped v1', freshness: 'stale', url: 'https://x.com/u1/status/7' })
    expect(row.claims).toEqual([
      { side: 'for', text: 'Shipped a product', status: 'verified', evidence: [{ id: 'post:7', url: 'https://x.com/u1/status/7' }] },
    ])
  })

  it('shows fund criteria and the date of the latest stored post', async () => {
    const criteria = [{ text: 'Based in or building for Southeast Asia', status: 'met' as const, evidenceIds: ['bio:1'] }]
    await addProspect('1', { fit: 'strong', criteria })
    await ds.getRepository(XPost).save([
      { postId: 'a', xUserId: '1', text: '', postedAt: daysAgo(9), fetchedAt: now },
      { postId: 'b', xUserId: '1', text: '', postedAt: daysAgo(2), fetchedAt: now },
    ])
    await addProspect('2')

    const [first, second] = await new ProspectsService(ds).list(1, now)
    expect(first.criteria).toEqual(criteria)
    expect(first.lastPostAt).toEqual(daysAgo(2))
    expect(second.criteria).toEqual([])
    expect(second.lastPostAt).toBeNull()
  })

  it('warns that identity is not confirmed for parody or fan accounts', async () => {
    await addProspect('1', {}, 'Parody account of an AI researcher')
    await addProspect('2', {}, 'ai builder')
    const list = await new ProspectsService(ds).list(1, now)
    expect(Object.fromEntries(list.map((p) => [p.handle, p.identityWarning]))).toEqual({ u1: true, u2: false })
  })
})
