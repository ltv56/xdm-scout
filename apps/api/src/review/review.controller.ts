import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Campaign } from '../discovery/entities'
import { ReviewService } from './review.service'

@Controller()
export class ReviewController {
  constructor(
    private readonly ds: DataSource,
    private readonly review: ReviewService,
  ) {}

  @Get('review-queue')
  async queue(@Query('campaignId') campaignId: string) {
    const id = Number(campaignId)
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('campaignId must be a positive integer')
    if (!(await this.ds.getRepository(Campaign).findOneBy({ id }))) throw new NotFoundException('Campaign not found')
    return this.review.queue(id)
  }
}
