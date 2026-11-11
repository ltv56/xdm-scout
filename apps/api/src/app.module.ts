import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthController } from './auth/auth.controller'
import { AuthService, X_AUTH_CONFIG, XAuthConfig } from './auth/auth.service'
import { dataSourceOptions } from './data-source'
import { HealthController } from './health.controller'
import { JobsService } from './jobs/jobs.service'
import { DraftsController } from './sending/drafts.controller'
import { SendingService } from './sending/sending.service'
import { Worker } from './sending/worker'
import { FakeXClient } from './x/fake-x-client'
import { X_CLIENT } from './x/x-client'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, migrations: [] }),
  ],
  controllers: [HealthController, DraftsController, AuthController],
  providers: [
    JobsService,
    SendingService,
    Worker,
    AuthService,
    {
      provide: X_AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): XAuthConfig => ({
        clientId: config.get('X_CLIENT_ID', ''),
        clientSecret: config.get('X_CLIENT_SECRET', ''),
        redirectUri: config.get('X_REDIRECT_URI', 'http://localhost:3000/api/auth/x/callback'),
        tokenKey: config.get('TOKEN_KEY', ''),
      }),
    },
    { provide: X_CLIENT, useClass: FakeXClient },
  ],
})
export class AppModule {}
