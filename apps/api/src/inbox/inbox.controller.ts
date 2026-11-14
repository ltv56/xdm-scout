import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Campaign } from '../discovery/entities'
import { confirmBody } from './contract'
import { InboxService } from './inbox.service'

@Controller()
export class InboxController {
  constructor(
    private readonly ds: DataSource,
    private readonly inbox: InboxService,
  ) {}

  @Get('inbox/checks')
  async checks(@Query('campaignId') campaignId: string) {
    const id = Number(campaignId)
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('campaignId must be a positive integer')
    if (!(await this.ds.getRepository(Campaign).findOneBy({ id }))) throw new NotFoundException('Campaign not found')
    return this.inbox.checks(id)
  }

  @Post('send-attempts/:id/confirm')
  async confirm(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const r = confirmBody.safeParse(body)
    if (!r.success) throw new BadRequestException('outcome must be "sent" or "not_sent"')
    await this.inbox.confirm(id, r.data.outcome)
    return { ok: true }
  }
}
