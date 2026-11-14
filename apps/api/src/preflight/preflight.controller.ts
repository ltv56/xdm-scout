import { Controller, Get } from '@nestjs/common'
import { PreflightService } from './preflight.service'

@Controller('preflight')
export class PreflightController {
  constructor(private readonly preflight: PreflightService) {}

  @Get()
  run() {
    return this.preflight.run()
  }
}

@Controller('health/details')
export class HealthDetailsController {
  constructor(private readonly preflight: PreflightService) {}

  @Get()
  details() {
    return this.preflight.details(new Date())
  }
}
