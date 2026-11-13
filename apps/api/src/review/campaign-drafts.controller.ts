import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Campaign } from '../discovery/entities'
import { ReadyToDraft, WriteDraftsResult, writeDraftsBody } from './contract'
import { DraftService } from './draft.service'

@Controller('campaigns/:id/drafts')
export class CampaignDraftsController {
  constructor(
    private readonly ds: DataSource,
    private readonly drafts: DraftService,
  ) {}

  @Get('ready')
  async ready(@Param('id', ParseIntPipe) id: number): Promise<ReadyToDraft> {
    await this.campaign(id)
    return { ready: (await this.drafts.ready(id)).length }
  }

  @Post()
  async create(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<WriteDraftsResult> {
    await this.campaign(id)
    const parsed = writeDraftsBody.safeParse(body ?? {})
    if (!parsed.success) throw new BadRequestException('limit must be a whole number from 1 to 10')
    return this.drafts.writeDrafts(id, parsed.data.limit)
  }

  private async campaign(id: number) {
    if (!(await this.ds.getRepository(Campaign).findOneBy({ id }))) throw new NotFoundException('Campaign not found')
  }
}
