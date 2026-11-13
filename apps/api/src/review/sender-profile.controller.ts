import { BadRequestException, Body, Controller, Get, Post, Put } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Setting } from '../setting.entity'
import { FramePreview, SenderProfile, senderProfile } from './contract'
import { applyFrame } from './draft-frame'
import { layoutText } from './draft-text'
import { greetingFor } from './greeting'

const KEY = 'sender_profile'

@Controller('sender-profile')
export class SenderProfileController {
  constructor(private readonly ds: DataSource) {}

  async get(): Promise<SenderProfile | null> {
    const row = await this.ds.getRepository(Setting).findOneBy({ key: KEY })
    return (row?.value as SenderProfile | undefined) ?? null
  }

  @Get()
  read() {
    return this.get()
  }

  // Fills the frame on a sample person and a sample message, without saving anything.
  @Post('preview')
  preview(@Body() body: unknown): FramePreview {
    const profile = parse(body)
    const message = [
      { text: 'Saw your post about shipping v2 of your eval harness.', source: { type: 'evidence' as const, evidenceId: 'sample' } },
      { text: profile.intro, source: { type: 'sender_profile' as const, field: 'intro' as const } },
      { text: 'No worries if not.', source: { type: 'opt_out' as const } },
    ]
    const greeting = { text: greetingFor('Mai', 'sample', 'en', profile.frame?.greeting ?? null), source: { type: 'greeting' as const } }
    return { text: layoutText(applyFrame(greeting, message, profile.frame)) }
  }

  @Put()
  async save(@Body() body: unknown): Promise<SenderProfile> {
    const parsed = { data: parse(body) }
    await this.ds.getRepository(Setting).save({ key: KEY, value: parsed.data })
    return parsed.data
  }
}

function parse(body: unknown): SenderProfile {
  const parsed = senderProfile.safeParse(body)
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return parsed.data
}
