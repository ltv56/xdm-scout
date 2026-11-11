import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { dataSourceOptions } from './data-source'
import { HealthController } from './health.controller'
import { DraftsController } from './sending/drafts.controller'
import { JobsService } from './jobs/jobs.service'
import { SendingService } from './sending/sending.service'
import { Worker } from './sending/worker'
import { FakeXClient } from './x/fake-x-client'
import { X_CLIENT } from './x/x-client'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    TypeOrmModule.forRoot({ ...dataSourceOptions, migrations: [] }),
  ],
  controllers: [HealthController, DraftsController],
  providers: [JobsService, SendingService, Worker, { provide: X_CLIENT, useClass: FakeXClient }],
})
export class AppModule {}
