import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { RepliesService } from './inbox/replies.service'
import { RetentionService } from './retention/retention.service'
import { Worker } from './sending/worker'

const SWEEP_EVERY_MS = 3_600_000
const REPLY_SCHEDULE_EVERY_MS = 60_000

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const retention = app.get(RetentionService)
  const sweep = () => retention.sweep(new Date()).catch((err: unknown) => console.error('retention sweep failed', err))
  void sweep()
  setInterval(() => void sweep(), SWEEP_EVERY_MS)
  const replies = app.get(RepliesService)
  const scheduleReplies = () => replies.scheduleNext(new Date()).catch((err: unknown) => console.error('reply schedule failed', err))
  setInterval(() => void scheduleReplies(), REPLY_SCHEDULE_EVERY_MS)
  await app.get(Worker).run()
}

void bootstrap()
