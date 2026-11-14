import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Campaign } from '../discovery/entities'
import { confirmBody } from './contract'
import { InboxService } from './inbox.service'
import { RepliesService } from './replies.service'

@Controller()
export class InboxController {
  constructor(
    private readonly ds: DataSource,
    private readonly inbox: InboxService,
    private readonly replies: RepliesService,
  ) {}

  @Get('inbox/checks')
  async checks(@Query('campaignId') campaignId: string) {
    return this.inbox.checks(await this.campaignId(campaignId))
  }

  @Post('inbox/check-now')
  async checkNow(@Query('campaignId') campaignId: string) {
    return this.replies.checkNow(await this.campaignId(campaignId), new Date())
  }

  @Post('replies/:id/handled')
  async handled(@Param('id', ParseIntPipe) id: number) {
    await this.inbox.markHandled(id)
    return { ok: true }
  }

  @Post('send-attempts/:id/replied')
  async replied(@Param('id', ParseIntPipe) id: number) {
    await this.replies.markReplied(id, new Date())
    return { ok: true }
  }

  @Post('send-attempts/:id/confirm')
  async confirm(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const r = confirmBody.safeParse(body)
    if (!r.success) throw new BadRequestException('outcome must be "sent" or "not_sent"')
    await this.inbox.confirm(id, r.data.outcome)
    return { ok: true }
  }

  private async campaignId(raw: string) {
    const id = Number(raw)
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('campaignId must be a positive integer')
    if (!(await this.ds.getRepository(Campaign).findOneBy({ id }))) throw new NotFoundException('Campaign not found')
    return id
  }
}
