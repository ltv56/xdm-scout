import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDataSource } from '../test/db'
import { framePreview, senderProfile } from './contract'
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

  it('keeps programs to 8, with a link that is a URL and a deadline that is a date', async () => {
    const p = profile.programs[0]
    await expect(controller.save({ ...profile, programs: Array.from({ length: 9 }, (_, i) => ({ ...p, id: i + 1 })) })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.save({ ...profile, programs: [{ ...p, link: 'genaifund.ai' }] })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.save({ ...profile, programs: [{ ...p, deadline: '30 Nov' }] })).rejects.toBeInstanceOf(BadRequestException)
    const ok = { ...profile, programs: [{ ...p, deadline: '2026-11-30' }] }
    expect(await controller.save(ok)).toEqual(ok)
  })

  it('keeps an optional draft frame: greeting with {name}, opt-out line, contact line', async () => {
    const withFrame = { ...profile, frame: { greeting: 'Dear {name},', optOut: 'Ignore this if it is not for you.', contactLine: 'Write to vinh@genaifund.ai' } }
    expect(await controller.save(withFrame)).toEqual(withFrame)
    expect(await controller.save({ ...withFrame, frame: { greeting: null, optOut: null, contactLine: null } })).toMatchObject({ frame: { greeting: null } })
  })

  it('rejects a frame greeting without {name} and a frame line that is too long', async () => {
    await expect(controller.save({ ...profile, frame: { greeting: 'Dear friend,', optOut: null, contactLine: null } })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.save({ ...profile, frame: { greeting: null, optOut: 'x'.repeat(161), contactLine: null } })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('previews a frame on a sample person without saving it', async () => {
    const frame = { greeting: 'Dear {name},', optOut: 'Ignore this if it is not for you.', contactLine: 'Write to vinh@genaifund.ai' }
    const preview = await controller.preview({ ...profile, frame })
    expect(preview.text.split('\n')).toEqual(['Dear Mai,', expect.any(String), 'Ignore this if it is not for you.', 'Write to vinh@genaifund.ai'])
    expect(framePreview.parse(preview)).toEqual(preview)
    expect(await controller.get()).toBeNull()
  })
})
