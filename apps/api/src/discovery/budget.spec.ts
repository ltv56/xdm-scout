import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDataSource } from '../test/db'
import { FakeXClient } from '../x/fake-x-client'
import { DiscoveryService } from './discovery.service'
import { ApiUsage, Campaign, Prospect } from './entities'
import { PRICES } from './pricing'

let ds: DataSource
let x: FakeXClient
let discovery: DiscoveryService

const now = new Date('2026-11-12T10:00:00Z')
const usd = (micros: number) => micros
const post = (id: string, userId: string) => ({ id, userId, text: `post ${id}`, createdAt: new Date('2026-11-10T00:00:00Z') })

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  discovery = new DiscoveryService(ds, x)
  for (const n of [1, 2, 3, 4, 5]) {
    x.addProfile({ id: String(n), handle: `p${n}`, bio: 'robotics builder' })
    x.addPosts(String(n), [post(`${n}01`, String(n)), post(`${n}02`, String(n))])
  }
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

const newCampaign = (handles: string[], budgetMicros: number) =>
  ds.getRepository(Campaign).save({ name: 'c', keywords: ['robotics'], handles, budgetMicros })

const usageTotal = async () =>
  Number((await ds.getRepository(ApiUsage).createQueryBuilder('u').select('COALESCE(SUM(u.costMicros), 0)', 's').getRawOne()).s)

describe('discovery budget', () => {
  it('estimates profiles and an upper bound for posts before running, and drops cached profiles', async () => {
    const campaign = await newCampaign(['p1', 'p2', 'p3'], usd(5_000_000))
    expect(await discovery.estimate(campaign.id, now)).toEqual({
      profiles: 3,
      maxPosts: 45,
      maxFollowing: 0,
      maxSearch: 0,
      estimatedMicros: 3 * PRICES.profile + 45 * PRICES.post,
    })

    await discovery.run(campaign.id, now)
    expect((await discovery.estimate(campaign.id, now)).profiles).toBe(0)
    expect((await discovery.estimate(campaign.id, now)).maxPosts).toBe(0)
  })

  it('records every paid read and does not pay again for what is cached', async () => {
    const campaign = await newCampaign(['p1', 'p2'], usd(5_000_000))
    const first = await discovery.run(campaign.id, now)
    expect(first.spentMicros).toBe(2 * PRICES.profile + 4 * PRICES.post)
    expect(await usageTotal()).toBe(first.spentMicros)

    const second = await discovery.run(campaign.id, now)
    expect(second.spentMicros).toBe(0)
    expect(await usageTotal()).toBe(first.spentMicros)
  })

  it('stops when the budget cannot pay for the next profiles, keeps what it has and reports the spend', async () => {
    const campaign = await newCampaign(['p1', 'p2', 'p3', 'p4', 'p5'], 3 * PRICES.profile)
    const result = await discovery.run(campaign.id, now)

    expect(result.stoppedByBudget).toBe(true)
    expect(result.spentMicros).toBe(3 * PRICES.profile)
    expect(await ds.getRepository(Prospect).count()).toBe(3)
    expect(result.skipped.filter((s) => s.reason === 'budget').map((s) => s.handle)).toEqual(['p4', 'p5'])
  })

  it('stops reading posts when the rest of the budget cannot cover a full read of one person', async () => {
    const budget = 2 * PRICES.profile + 15 * PRICES.post + PRICES.post
    const campaign = await newCampaign(['p1', 'p2'], budget)
    const result = await discovery.run(campaign.id, now)

    expect(result.stoppedByBudget).toBe(true)
    expect(result.spentMicros).toBe(2 * PRICES.profile + 2 * PRICES.post)
    expect(result.spentMicros).toBeLessThanOrEqual(budget)
    expect(result.postsPending).toBe(1)
    expect(await ds.getRepository(Prospect).count()).toBe(2)
  })
})
