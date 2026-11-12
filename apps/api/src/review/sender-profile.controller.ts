import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Setting } from '../setting.entity'
import { SenderProfile, senderProfile } from './contract'

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

  @Put()
  async save(@Body() body: unknown): Promise<SenderProfile> {
    const parsed = senderProfile.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    await this.ds.getRepository(Setting).save({ key: KEY, value: parsed.data })
    return parsed.data
  }
}
