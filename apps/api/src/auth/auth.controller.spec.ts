import 'reflect-metadata'
import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

const mode = (xMode: string) => ({ get: () => xMode }) as never

describe('AuthController fake login', () => {
  it('connects the made-up sender account in fake mode', async () => {
    let connected = 0
    const auth = { connectFake: async () => ({ handle: 'sandbox_sender', n: ++connected }) } as unknown as AuthService
    expect(await new AuthController(auth, mode('fake')).fake()).toEqual({ handle: 'sandbox_sender' })
    expect(connected).toBe(1)
  })

  it('does not exist in live mode', async () => {
    const auth = { connectFake: async () => ({ handle: 'sandbox_sender' }) } as unknown as AuthService
    await expect(new AuthController(auth, mode('live')).fake()).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('AuthController status', () => {
  it('adds the mode to the account status', async () => {
    const seen: string[] = []
    const auth = {
      status: async (m: string) => {
        seen.push(m)
        return { connected: true, handle: 'sandbox_sender', tokenExpiresAt: null, missingScopes: [] }
      },
    } as unknown as AuthService
    expect(await new AuthController(auth, mode('fake')).status()).toEqual({
      mode: 'fake',
      connected: true,
      handle: 'sandbox_sender',
      tokenExpiresAt: null,
      missingScopes: [],
    })
    expect(seen).toEqual(['fake'])
  })
})
