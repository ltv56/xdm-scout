import 'reflect-metadata'
import { NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Job } from '../jobs/job.entity'
import { JobsService } from '../jobs/jobs.service'
import { createTestDataSource } from '../test/db'
import { FakeXClient } from '../x/fake-x-client'
import { CampaignsController } from './campaigns.controller'
import { DiscoveryService } from './discovery.service'
import { ProspectsService } from './prospects.service'

let ds: DataSource
let controller: CampaignsController

beforeEach(async () => {
  ds = await createTestDataSource()
  controller = new CampaignsController(ds, new JobsService(ds), new DiscoveryService(ds, new FakeXClient()), new ProspectsService(ds))
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

describe('campaigns API', () => {
  it('answers 404 for a campaign that does not exist', async () => {
    await expect(controller.discover(999)).rejects.toBeInstanceOf(NotFoundException)
    await expect(controller.estimate(999)).rejects.toBeInstanceOf(NotFoundException)
    await expect(controller.get(999)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('does not queue a second discovery while one is pending or running', async () => {
    const campaign = await controller.create({ name: 'c', keywords: ['ai'], handles: ['alice'] })
    expect(await controller.discover(campaign.id)).toEqual({ queued: true })
    expect(await controller.discover(campaign.id)).toEqual({ queued: false, reason: 'Discovery is already running for this campaign' })
    expect(await ds.getRepository(Job).countBy({ type: 'discover' })).toBe(1)
  })

  it('returns the campaign with its last discovery run', async () => {
    const campaign = await controller.create({ name: 'c', keywords: ['ai'], handles: ['alice'] })
    expect(await controller.get(campaign.id)).toMatchObject({ id: campaign.id, name: 'c', lastDiscovery: null })
  })
})
