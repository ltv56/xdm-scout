import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { AppModule } from './app.module'
import { HealthController } from './health.controller'

let controller: HealthController
let close: () => Promise<void>

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  await moduleRef.init()
  controller = moduleRef.get(HealthController)
  close = () => moduleRef.close()
})

afterAll(() => close())

it('reports the database as up', async () => {
  expect(await controller.check()).toEqual({ status: 'ok', db: 'up' })
})
