import 'reflect-metadata'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Job } from '../jobs/job.entity'
import { JobsService } from '../jobs/jobs.service'
import { Setting } from '../setting.entity'
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

  it('lists campaigns, newest first, with id and name only', async () => {
    const a = await controller.create({ name: 'a', keywords: ['ai'], handles: ['alice'] })
    const b = await controller.create({ name: 'b', keywords: ['ai'], handles: ['bob'] })
    expect(await controller.listCampaigns()).toEqual([
      { id: b.id, name: 'b' },
      { id: a.id, name: 'a' },
    ])
  })

  it('returns the campaign with its last discovery run', async () => {
    const campaign = await controller.create({ name: 'c', keywords: ['ai'], handles: ['alice'] })
    expect(await controller.get(campaign.id)).toMatchObject({ id: campaign.id, name: 'c', lastDiscovery: null })
  })
})

describe('program and call post', () => {
  const profile = { intro: 'We back founders.', programs: [{ id: 3, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null }], signer: 'Vinh', sampleMessages: [] }
  const base = { name: 'c', keywords: ['ai'], handles: ['alice'] }
  const post = (at: string) => `https://x.com/genaifund_ai/status/${BigInt(Date.parse(at) - 1288834974657) << 22n}`

  beforeEach(async () => {
    await ds.getRepository(Setting).save({ key: 'sender_profile', value: profile })
  })

  it('keeps the program and the call post, and reads the posting time off the post id', async () => {
    const c = await controller.create({ ...base, programId: 3, callPostUrl: post('2026-11-01T03:00:00Z'), callKeyword: ' build ' })
    expect(await controller.get(c.id)).toMatchObject({ programId: 3, callKeyword: 'build', callPostedAt: new Date('2026-11-01T03:00:00Z') })
  })

  it('starts with no program and no call post', async () => {
    const c = await controller.create(base)
    expect(await controller.get(c.id)).toMatchObject({ programId: null, callPostUrl: null, callKeyword: null, callPostedAt: null })
  })

  it('updates them, and clears the call post when both fields are null', async () => {
    const c = await controller.create(base)
    const url = post('2026-11-01T03:00:00Z')
    await controller.updateLane(c.id, { programId: 3, callPostUrl: url, callKeyword: 'build' })
    expect(await controller.get(c.id)).toMatchObject({ programId: 3, callPostUrl: url })
    await controller.updateLane(c.id, { programId: 3, callPostUrl: null, callKeyword: null })
    expect(await controller.get(c.id)).toMatchObject({ callPostUrl: null, callKeyword: null, callPostedAt: null })
  })

  it('rejects a half-filled or wrong call post, a program that is not in the profile and unknown keys', async () => {
    const url = post('2026-11-01T03:00:00Z')
    const bad = [
      { programId: 3, callPostUrl: url },
      { programId: 3, callKeyword: 'build' },
      { programId: 3, callPostUrl: 'https://example.com/post/1', callKeyword: 'build' },
      { programId: 3, callPostUrl: post('2099-01-01T00:00:00Z'), callKeyword: 'build' },
      { programId: 99 },
      { programId: 3, callKeyword: 'x'.repeat(41), callPostUrl: url },
      { surprise: true },
    ]
    for (const extra of bad) await expect(controller.create({ ...base, ...extra })).rejects.toBeInstanceOf(BadRequestException)
    const c = await controller.create(base)
    await expect(controller.updateLane(c.id, { programId: 3, callPostUrl: url, callKeyword: null })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.updateLane(999, { programId: null, callPostUrl: null, callKeyword: null })).rejects.toBeInstanceOf(NotFoundException)
  })
})
