import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthController } from './auth/auth.controller'
import { AuthService, X_AUTH_CONFIG, XAuthConfig } from './auth/auth.service'
import { dataSourceOptions } from './data-source'
import { HealthController } from './health.controller'
import { CampaignsController } from './discovery/campaigns.controller'
import { DiscoveryService } from './discovery/discovery.service'
import { ProspectsService } from './discovery/prospects.service'
import { FitService } from './fit/fit.service'
import { JobsService } from './jobs/jobs.service'
import { cannedHandler, FakeLlmClient } from './llm/fake-llm-client'
import { AnthropicLlmClient, OpenAiCompatibleLlmClient } from './llm/http-llm-clients'
import { LLM_CLIENT, LlmClient } from './llm/llm-client'
import { RetentionService } from './retention/retention.service'
import { ReviewStubController } from './review/review-stub.controller'
import { DraftsController } from './sending/drafts.controller'
import { SendingService } from './sending/sending.service'
import { Worker } from './sending/worker'
import { FakeXClient } from './x/fake-x-client'
import { LiveXClient } from './x/live-x-client'
import { X_CLIENT, XClient } from './x/x-client'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, migrations: [] }),
  ],
  // REVIEW_STUB=1 serves fixed review data (see review/contract.ts) instead of the real draft routes.
  controllers: [HealthController, process.env.REVIEW_STUB === '1' ? ReviewStubController : DraftsController, AuthController, CampaignsController],
  providers: [
    JobsService,
    DiscoveryService,
    ProspectsService,
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
    FitService,
    RetentionService,
    {
      provide: LLM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmClient => {
        const apiKey = config.get('LLM_API_KEY', '')
        const model = config.get('LLM_MODEL', '')
        if (!apiKey || !model) return new FakeLlmClient(cannedHandler)
        if (config.get('LLM_PROVIDER', 'openai') === 'anthropic') return new AnthropicLlmClient({ apiKey, model })
        return new OpenAiCompatibleLlmClient({ apiKey, model, baseUrl: config.get('LLM_BASE_URL', 'https://api.openai.com/v1') })
      },
    },
    {
      provide: X_CLIENT,
      inject: [ConfigService, AuthService],
      useFactory: (config: ConfigService, auth: AuthService): XClient =>
        config.get('X_MODE', 'fake') === 'live' ? new LiveXClient(() => auth.session()) : FakeXClient.fromFixtures(),
    },
  ],
})
export class AppModule {}
