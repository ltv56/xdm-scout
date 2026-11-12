import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common'
import { DataSource, IsNull } from 'typeorm'
import { z } from 'zod'
import { JobsService } from '../jobs/jobs.service'
import { DiscoveryService } from './discovery.service'
import { Campaign, Prospect } from './entities'
import { ProspectsService } from './prospects.service'

const createBody = z
  .object({
    name: z.string().min(1).max(128),
    keywords: z.array(z.string().min(1)).min(1),
    handles: z.array(z.string().min(1)).default([]),
    seeds: z.array(z.string().min(1)).max(10).default([]),
    queries: z.array(z.string().min(1).max(512)).max(10).default([]),
    criteria: z.array(z.string().min(1).max(200)).max(5).default([]),
    budgetUsd: z.number().positive().max(100).optional(),
  })
  .refine((b) => b.handles.length + b.seeds.length + b.queries.length > 0, {
    message: 'Give at least one handle, seed account or search query',
  })

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly ds: DataSource,
    private readonly jobs: JobsService,
    private readonly discovery: DiscoveryService,
    private readonly prospects: ProspectsService,
  ) {}

  @Post()
  create(@Body() body: unknown) {
    const parsed = createBody.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '))
    const { budgetUsd, ...rest } = parsed.data
    return this.ds.getRepository(Campaign).save({ ...rest, ...(budgetUsd && { budgetMicros: Math.round(budgetUsd * 1_000_000) }) })
  }

  @Get(':id/estimate')
  async estimate(@Param('id', ParseIntPipe) id: number) {
    return { ...(await this.discovery.estimate(id)), note: 'estimate at the prices in discovery/pricing.ts' }
  }

  @Post(':id/discover')
  async discover(@Param('id', ParseIntPipe) id: number) {
    await this.ds.getRepository(Campaign).findOneByOrFail({ id })
    await this.jobs.enqueue('discover', { campaignId: id }, new Date())
    return { queued: true }
  }

  @Post(':id/score')
  async score(@Param('id', ParseIntPipe) id: number) {
    const pending = await this.ds.getRepository(Prospect).findBy({ campaignId: id, scoredAt: IsNull() })
    for (const p of pending) await this.jobs.enqueue('score', { prospectId: p.id }, new Date())
    return { queued: pending.length }
  }

  @Get(':id/prospects')
  list(@Param('id', ParseIntPipe) id: number) {
    return this.prospects.list(id)
  }
}
