import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptToken, encryptToken } from './token-crypto'

const key = randomBytes(32).toString('base64')

describe('token crypto', () => {
  it('round-trips and does not contain the plaintext', () => {
    const enc = encryptToken('secret-token', key)
    expect(enc).not.toContain('secret-token')
    expect(decryptToken(enc, key)).toBe('secret-token')
  })

  it('uses a fresh nonce each time', () => {
    expect(encryptToken('a', key)).not.toBe(encryptToken('a', key))
  })

  it('fails on a tampered value', () => {
    const enc = encryptToken('secret-token', key)
    const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA')
    expect(() => decryptToken(tampered, key)).toThrow()
  })

  it('fails with the wrong key', () => {
    const enc = encryptToken('secret-token', key)
    expect(() => decryptToken(enc, randomBytes(32).toString('base64'))).toThrow()
  })

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptToken('x', Buffer.from('short').toString('base64'))).toThrow('32 bytes')
  })
})
