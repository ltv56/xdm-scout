import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { DataSource } from 'typeorm'

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1')
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' })
    }
    return { status: 'ok', db: 'up' }
  }
}
