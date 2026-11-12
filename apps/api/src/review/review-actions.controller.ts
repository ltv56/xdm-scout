import { BadRequestException, Body, Controller, Param, ParseIntPipe, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { approveBody, editBody } from './contract'
import { ReviewActionsService } from './review-actions.service'

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body)
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return r.data
}

@Controller('drafts')
export class ReviewActionsController {
  constructor(private readonly actions: ReviewActionsService) {}

  @Patch(':id')
  async edit(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.actions.edit(id, parse(editBody, body).text)
  }

  @Post(':id/approve')
  async approve(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.actions.approve(id, parse(approveBody, body))
  }
}
