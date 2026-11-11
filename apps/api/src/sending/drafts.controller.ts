import { BadRequestException, Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common'
import { z } from 'zod'
import { SendingService } from './sending.service'

const approveBody = z.object({ contentHash: z.string().length(64) })

@Controller('drafts')
export class DraftsController {
  constructor(private readonly sending: SendingService) {}

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const parsed = approveBody.safeParse(body)
    if (!parsed.success) throw new BadRequestException('contentHash is required')
    return this.sending.approveAndSend(id, parsed.data.contentHash)
  }
}
