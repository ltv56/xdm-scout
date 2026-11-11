import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64')
  if (bytes.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes, base64 encoded')
  return bytes
}

// Layout: nonce(12) | auth tag(16) | ciphertext, base64.
export function encryptToken(plain: string, key: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64')
}

export function decryptToken(encoded: string, key: string): string {
  const raw = Buffer.from(encoded, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}
