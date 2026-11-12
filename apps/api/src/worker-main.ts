import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { Worker } from './sending/worker'

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  await app.get(Worker).run()
}

void bootstrap()
