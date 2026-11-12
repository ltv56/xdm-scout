import { Controller, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Campaign } from '../discovery/entities'
import { DraftService } from './draft.service'

@Controller('campaigns/:id/drafts')
export class CampaignDraftsController {
  constructor(
    private readonly ds: DataSource,
    private readonly drafts: DraftService,
  ) {}

  @Post()
  async create(@Param('id', ParseIntPipe) id: number) {
    if (!(await this.ds.getRepository(Campaign).findOneBy({ id }))) throw new NotFoundException('Campaign not found')
    return this.drafts.enqueueForCampaign(id)
  }
}
