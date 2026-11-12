import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDataSource } from '../test/db'
import { FakeXClient } from '../x/fake-x-client'
import { DiscoveryService } from './discovery.service'
import { ApiUsage, Campaign, Prospect } from './entities'
import { MAX_SEARCH_RESULTS, PRICES } from './pricing'

let ds: DataSource
let x: FakeXClient
let discovery: DiscoveryService

const now = new Date('2026-11-12T10:00:00Z')

beforeEach(async () => {
  ds = await createTestDataSource()
  x = new FakeXClient()
  discovery = new DiscoveryService(ds, x)
  x.addProfile({ id: '1', handle: 'alice', bio: 'Building robotics foundation models' })
  x.addProfile({ id: '2', handle: 'bob', bio: 'LLM agents' })
  x.addProfile({ id: '3', handle: 'chef', bio: 'I cook pasta' })
  x.addSearch('"robot arm" -is:retweet', ['alice', 'bob', 'alice', 'chef'])
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

const newCampaign = (queries: string[], budgetMicros = 5_000_000) =>
  ds.getRepository(Campaign).save({ name: 'c', keywords: ['robotics', 'llm'], handles: [], queries, budgetMicros })

const usage = async () => (await ds.getRepository(ApiUsage).find({ order: { id: 'ASC' } })).map((u) => [u.kind, u.count])

describe('discovery from keyword search', () => {
  it('adds the authors of matching posts as cold prospects and bills posts and authors', async () => {
    const campaign = await newCampaign(['"robot arm" -is:retweet'])

    const result = await discovery.run(campaign.id, now)

    const prospects = await ds.getRepository(Prospect).find({ order: { xUserId: 'ASC' } })
    expect(prospects.map((p) => [p.xUserId, p.relationship])).toEqual([
      ['1', 'cold'],
      ['2', 'cold'],
    ])
    expect(result.skipped).toEqual([{ handle: 'chef', reason: 'off-topic' }])
    expect((await usage()).slice(0, 2)).toEqual([
      ['search', 4],
      ['profile', 3],
    ])
    expect(x.searchCalls).toEqual([{ query: '"robot arm" -is:retweet', max: MAX_SEARCH_RESULTS }])
  })

  it('skips a query when the budget cannot pay for the smallest search X allows', async () => {
    const campaign = await newCampaign(['"robot arm" -is:retweet'], 9 * (PRICES.post + PRICES.profile))

    const result = await discovery.run(campaign.id, now)

    expect(result.stoppedByBudget).toBe(true)
    expect(x.searchCalls).toEqual([])
  })

  it('includes an upper bound for search reads in the estimate', async () => {
    const campaign = await newCampaign(['a', 'b'])

    const estimate = await discovery.estimate(campaign.id, now)

    expect(estimate.maxSearch).toBe(2 * MAX_SEARCH_RESULTS)
    expect(estimate.estimatedMicros).toBe(2 * MAX_SEARCH_RESULTS * (PRICES.post + PRICES.profile))
  })
})
