import { describe, expect, it } from 'vitest'
import { postedAtFromId } from './post-id'

const X_EPOCH_MS = 1288834974657
const idAt = (iso: string, low = 0n) => ((BigInt(Date.parse(iso) - X_EPOCH_MS) << 22n) | low).toString()

describe('postedAtFromId', () => {
  it('reads the posting time off the post id', () => {
    expect(postedAtFromId(idAt('2026-11-01T03:00:00Z'))?.toISOString()).toBe('2026-11-01T03:00:00.000Z')
  })

  it('ignores the machine and sequence bits below the time', () => {
    expect(postedAtFromId(idAt('2026-11-01T03:00:00.123Z', (1n << 22n) - 1n))?.toISOString()).toBe('2026-11-01T03:00:00.123Z')
  })

  it('gives null for what is not a time-based post id', () => {
    expect(postedAtFromId('')).toBeNull()
    expect(postedAtFromId('abc')).toBeNull()
    expect(postedAtFromId('12a4')).toBeNull()
    expect(postedAtFromId('20')).toBeNull()
  })
})
