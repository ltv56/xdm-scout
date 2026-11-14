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
import { DECISION_CLIENT } from './decisions/review-decisions'
import { createDecisionClient, createLlmClient } from './llm/ai-config'
import { LLM_CLIENT, LlmClient } from './llm/llm-client'
import { RetentionService } from './retention/retention.service'
import { CampaignDraftsController } from './review/campaign-drafts.controller'
import { DraftService } from './review/draft.service'
import { ProspectDraftController } from './review/prospect-draft.controller'
import { ReviewActionsController } from './review/review-actions.controller'
import { ReviewActionsService } from './review/review-actions.service'
import { ReviewController } from './review/review.controller'
import { ReviewService } from './review/review.service'
import { SenderProfileController } from './review/sender-profile.controller'
import { SendingService } from './sending/sending.service'
import { Worker } from './sending/worker'
import { FakeXClient } from './x/fake-x-client'
import { LiveXClient } from './x/live-x-client'
import { X_CLIENT, XClient } from './x/x-client'

const AI_VARS = ['GOOGLE_API_KEY', 'OPEN_ROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'LLM_MODEL', 'DECISION_MODEL']
const aiEnv = (config: ConfigService) => Object.fromEntries(AI_VARS.map((k) => [k, config.get<string>(k, '')]))

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, migrations: [] }),
  ],
  controllers: [
    HealthController,
    ReviewActionsController,
    SenderProfileController,
    CampaignDraftsController,
    ProspectDraftController,
    ReviewController,
    AuthController,
    CampaignsController,
  ],
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
    DraftService,
    ReviewService,
    ReviewActionsService,
    RetentionService,
    {
      provide: LLM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmClient => createLlmClient(aiEnv(config)),
    },
    {
      provide: DECISION_CLIENT,
      inject: [ConfigService, LLM_CLIENT],
      useFactory: (config: ConfigService, llm: LlmClient) => createDecisionClient(aiEnv(config), llm),
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
