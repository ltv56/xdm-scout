import { describe, expect, it } from 'vitest'
import { greetingFor, usableName } from './greeting'

describe('usableName', () => {
  it('keeps a plain display name', () => {
    expect(usableName('Mai Tran')).toBe('Mai Tran')
    expect(usableName('Budi')).toBe('Budi')
    expect(usableName('Anne-Marie O’Neil')).toBe('Anne-Marie O’Neil')
  })

  it('cuts tags, brackets and emoji after or around the name', () => {
    expect(usableName('Mai Tran | Building evals 🚀')).toBe('Mai Tran')
    expect(usableName('Ken Lim (he/him)')).toBe('Ken Lim')
    expect(usableName('🔥 Budi')).toBe('Budi')
    expect(usableName('Linh Pham - founder @ speechco')).toBe('Linh Pham')
    expect(usableName('Nguyen Thi Minh Khue (Dr.)')).toBe('Nguyen Thi Minh Khue')
  })

  it('refuses what is not a person name, so the greeting falls back to no name', () => {
    expect(usableName(null)).toBeNull()
    expect(usableName('')).toBeNull()
    expect(usableName('   ')).toBeNull()
    expect(usableName('@mai')).toBeNull()
    expect(usableName('GenAI Fund')).toBeNull()
    expect(usableName('Acme Labs')).toBeNull()
    expect(usableName('Daily AI News')).toBeNull()
    expect(usableName('A1 B2')).toBeNull()
    expect(usableName('NGUYEN VAN AN')).toBeNull()
    expect(usableName('Nguyen Van Thi Minh Khue')).toBeNull()
  })
})

describe('greetingFor', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => `u-${i}`)

  it('uses the name when there is one and stays short', () => {
    for (const s of seeds) {
      const g = greetingFor('Mai Tran', s)
      expect(g).toContain('Mai Tran')
      expect(g).toMatch(/[!.]$/)
      expect(g.length).toBeLessThanOrEqual(48)
    }
  })

  it('has a version without a name', () => {
    for (const s of seeds) {
      const g = greetingFor('Acme Labs', s)
      expect(g).not.toContain('Acme')
      expect(g).toMatch(/^(Hi|Hello|Hey)/)
      expect(g).toMatch(/[!.]$/)
    }
  })

  it('is the same for the same seed and does not repeat one pattern across people', () => {
    expect(greetingFor('Mai Tran', 'u-1')).toBe(greetingFor('Mai Tran', 'u-1'))
    expect(new Set(seeds.map((s) => greetingFor('Mai Tran', s))).size).toBeGreaterThanOrEqual(4)
    expect(new Set(seeds.map((s) => greetingFor(null, s))).size).toBeGreaterThanOrEqual(3)
  })
})
