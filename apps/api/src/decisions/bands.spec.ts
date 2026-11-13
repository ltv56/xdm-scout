import { describe, expect, it } from 'vitest'
import { bandOf, DEFAULT_THRESHOLDS } from './bands'

describe('bandOf', () => {
  it('starts at 0.7 and 0.3', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ high: 0.7, low: 0.3 })
  })

  it('calls 0.7 and above high, 0.3 and below low, the rest middle', () => {
    expect([0.95, 0.7, 0.69, 0.5, 0.31, 0.3, 0.02].map((p) => bandOf(p))).toEqual(['high', 'high', 'middle', 'middle', 'middle', 'low', 'low'])
  })

  it('uses thresholds it is given', () => {
    expect(bandOf(0.8, { high: 0.9, low: 0.4 })).toBe('middle')
  })

  it('refuses thresholds that cross or leave 0 to 1', () => {
    expect(() => bandOf(0.5, { high: 0.3, low: 0.7 })).toThrow(/thresholds/)
    expect(() => bandOf(0.5, { high: 1.2, low: 0.3 })).toThrow(/thresholds/)
  })
})
