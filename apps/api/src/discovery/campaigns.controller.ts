import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { z } from 'zod'
import { JobsService } from '../jobs/jobs.service'
import { XUser } from '../sending/entities'
import { Campaign, Prospect } from './entities'

const createBody = z.object({
  name: z.string().min(1).max(128),
  keywords: z.array(z.string().min(1)).min(1),
  handles: z.array(z.string().min(1)).min(1),
})

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly ds: DataSource,
    private readonly jobs: JobsService,
  ) {}

  @Post()
  create(@Body() body: unknown) {
    const parsed = createBody.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '))
    return this.ds.getRepository(Campaign).save(parsed.data)
  }

  @Post(':id/discover')
  async discover(@Param('id', ParseIntPipe) id: number) {
    await this.ds.getRepository(Campaign).findOneByOrFail({ id })
    await this.jobs.enqueue('discover', { campaignId: id }, new Date())
    return { queued: true }
  }

  @Get(':id/prospects')
  async prospects(@Param('id', ParseIntPipe) id: number) {
    const rows = await this.ds
      .createQueryBuilder(Prospect, 'p')
      .innerJoin(XUser, 'u', 'u.xUserId = p.xUserId')
      .where('p.campaignId = :id', { id })
      .select(['p.id AS id', 'p.relationship AS relationship', 'p.status AS status', 'u.handle AS handle', 'u.name AS name', 'u.bio AS bio', 'u.followers AS followers'])
      .orderBy('p.id')
      .getRawMany()
    return rows
  }
}
