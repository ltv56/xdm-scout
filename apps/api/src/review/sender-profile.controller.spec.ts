import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDataSource } from '../test/db'
import { senderProfile } from './contract'
import { SenderProfileController } from './sender-profile.controller'

let ds: DataSource
let controller: SenderProfileController

beforeEach(async () => {
  ds = await createTestDataSource()
  controller = new SenderProfileController(ds)
})

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy()
})

const profile = { intro: 'We back AI founders in SEA.', programs: [{ id: 1, name: 'Intro to investors', description: 'Intro to investors', link: 'https://genaifund.ai/', deadline: null }], signer: 'Vinh', sampleMessages: [] }

describe('sender profile', () => {
  it('is empty before the first save', async () => {
    expect(await controller.get()).toBeNull()
  })

  it('saves and reads back the profile', async () => {
    expect(await controller.save(profile)).toEqual(profile)
    expect(senderProfile.parse(await controller.get())).toEqual(profile)
  })

  it('overwrites the single profile on a second save', async () => {
    await controller.save(profile)
    await controller.save({ ...profile, signer: 'Mai' })
    expect(await controller.get()).toMatchObject({ signer: 'Mai' })
  })

  it('rejects a profile without programs', async () => {
    await expect(controller.save({ ...profile, programs: [] })).rejects.toBeInstanceOf(BadRequestException)
  })
})
