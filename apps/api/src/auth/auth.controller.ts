import { BadRequestException, Controller, Get, Query, Redirect } from '@nestjs/common'
import { AuthService } from './auth.service'

@Controller('auth/x')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('login')
  @Redirect()
  login() {
    return { url: this.auth.loginUrl() }
  }

  @Get('callback')
  async callback(@Query('code') code?: string, @Query('state') state?: string) {
    if (!code || !state) throw new BadRequestException('Missing code or state')
    try {
      await this.auth.handleCallback(code, state)
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'OAuth failed')
    }
    return 'X account connected. You can close this tab.'
  }
}
