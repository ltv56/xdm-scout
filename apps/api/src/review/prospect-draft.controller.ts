import { BadRequestException, Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common'
import { ReviewItem, skipBody } from './contract'
import { DraftService } from './draft.service'
import { ReviewService } from './review.service'

@Controller('campaigns/:id/prospects/:pid')
export class ProspectDraftController {
  constructor(
    private readonly drafts: DraftService,
    private readonly review: ReviewService,
  ) {}

  @Post('draft')
  async create(@Param('id', ParseIntPipe) id: number, @Param('pid', ParseIntPipe) pid: number): Promise<ReviewItem> {
    return this.review.one(await this.drafts.draftOne(id, pid))
  }

  @Post('dismiss')
  async dismiss(@Param('id', ParseIntPipe) id: number, @Param('pid', ParseIntPipe) pid: number, @Body() body: unknown) {
    const parsed = skipBody.safeParse(body)
    if (!parsed.success) throw new BadRequestException('reason must be one of the Skip reasons')
    await this.drafts.dismiss(id, pid, parsed.data.reason)
    return { ok: true }
  }
}
