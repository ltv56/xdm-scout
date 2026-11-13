import { BadRequestException, Body, Controller, Param, ParseIntPipe, Patch, Post } from '@nestjs/common'
import { z } from 'zod'
import { approveBody, editBody, languageBody, manualBody, regenerateBody, sendBody, skipBody } from './contract'
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

  @Post(':id/send')
  async send(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.actions.send(id, parse(sendBody, body).contentHash)
  }

  @Post(':id/language')
  async language(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.actions.language(id, parse(languageBody, body).language)
  }

  @Post(':id/skip')
  async skip(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.actions.skip(id, parse(skipBody, body))
  }

  @Post(':id/regenerate')
  async regenerate(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.actions.regenerate(id, parse(regenerateBody, body).note)
  }

  @Post(':id/dnc')
  async dnc(@Param('id', ParseIntPipe) id: number) {
    return this.actions.doNotContact(id)
  }

  @Post(':id/manual')
  async manual(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.actions.manual(id, parse(manualBody, body).outcome)
  }
}
