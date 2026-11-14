import { describe, expect, it } from 'vitest'
import { brier, calibrationTable, pickThreshold, precisionCoverage, splitHalves, wilson } from './eval'

const ex = (probability: number, yes: boolean) => ({ probability, yes })

describe('wilson', () => {
  it('gives the 95% interval for a rate', () => {
    const w = wilson(8, 10)
    expect(w.low).toBeCloseTo(0.49, 2)
    expect(w.high).toBeCloseTo(0.943, 2)
  })

  it('stays inside 0 to 1 at the edges and is empty for no examples', () => {
    expect(wilson(10, 10).high).toBeCloseTo(1, 5)
    expect(wilson(0, 10).low).toBeCloseTo(0, 5)
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
  })
})

describe('brier', () => {
  it('is the mean squared gap between probability and outcome', () => {
    expect(brier([ex(1, true), ex(0, false)])).toBe(0)
    expect(brier([ex(0.8, true), ex(0.4, false)])).toBeCloseTo((0.04 + 0.16) / 2, 10)
    expect(brier([])).toBeNull()
  })
})

describe('calibrationTable', () => {
  it('puts each example in a band and compares the mean probability with the real yes rate', () => {
    const rows = calibrationTable([ex(0.05, false), ex(0.15, false), ex(0.95, true), ex(0.85, true), ex(0.9, false)], 5)
    expect(rows.map((r) => [r.from, r.to, r.n])).toEqual([[0, 0.2, 2], [0.2, 0.4, 0], [0.4, 0.6, 0], [0.6, 0.8, 0], [0.8, 1, 3]])
    expect(rows[0]).toMatchObject({ meanProbability: 0.1, yesRate: 0 })
    expect(rows[4].meanProbability).toBeCloseTo(0.9, 10)
    expect(rows[4].yesRate).toBeCloseTo(2 / 3, 10)
    expect(rows[1]).toMatchObject({ meanProbability: null, yesRate: null })
  })

  it('counts a probability of exactly 1 in the top band', () => {
    expect(calibrationTable([ex(1, true)], 5)[4].n).toBe(1)
  })
})

describe('precisionCoverage', () => {
  it('counts a yes at or above the threshold: precision among them, and the share of all examples they cover', () => {
    const r = precisionCoverage([ex(0.9, true), ex(0.8, true), ex(0.7, false), ex(0.2, true)], 0.7)
    expect(r).toMatchObject({ n: 4, answeredYes: 3, right: 2 })
    expect(r.precision).toBeCloseTo(2 / 3, 10)
    expect(r.coverage).toBe(0.75)
    expect(r.precisionInterval).toEqual(wilson(2, 3))
  })

  it('has no precision when nothing reaches the threshold', () => {
    expect(precisionCoverage([ex(0.1, true)], 0.7)).toMatchObject({ answeredYes: 0, precision: null, coverage: 0 })
  })
})

describe('pickThreshold', () => {
  const many = (n: number, probability: number, yes: boolean) => Array.from({ length: n }, () => ex(probability, yes))

  it('takes the lowest threshold whose precision lower bound reaches the target', () => {
    const examples = [...many(20, 0.95, true), ...many(10, 0.6, false)]
    expect(pickThreshold(examples, { target: 0.7 })).toBe(0.65)
  })

  it('gives null when no threshold reaches the target', () => {
    expect(pickThreshold(many(30, 0.9, false), { target: 0.7 })).toBeNull()
  })

  it('needs at least ten yes answers at the threshold', () => {
    expect(pickThreshold(many(5, 0.95, true), { target: 0.3 })).toBeNull()
    expect(pickThreshold(many(10, 0.95, true), { target: 0.3 })).toBe(0.5)
  })
})

describe('splitHalves', () => {
  it('uses the first half to pick the threshold and the second only to report', () => {
    const { pick, report } = splitHalves([1, 2, 3, 4, 5])
    expect(pick).toEqual([1, 2])
    expect(report).toEqual([3, 4, 5])
  })
})
