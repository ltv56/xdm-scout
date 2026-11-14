export interface Labelled {
  probability: number
  yes: boolean
}

// Wilson score interval, 95%.
export function wilson(successes: number, n: number, z = 1.96) {
  if (n === 0) return { low: 0, high: 1 }
  const p = successes / n
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

export function brier(examples: Labelled[]): number | null {
  if (!examples.length) return null
  return examples.reduce((sum, e) => sum + (e.probability - (e.yes ? 1 : 0)) ** 2, 0) / examples.length
}

export function calibrationTable(examples: Labelled[], bands: number) {
  return Array.from({ length: bands }, (_, i) => {
    const from = i / bands
    const to = (i + 1) / bands
    const inBand = examples.filter((e) => e.probability >= from && (e.probability < to || (i === bands - 1 && e.probability <= to)))
    const n = inBand.length
    return {
      from: Math.round(from * 1e6) / 1e6,
      to: Math.round(to * 1e6) / 1e6,
      n,
      meanProbability: n ? inBand.reduce((s, e) => s + e.probability, 0) / n : null,
      yesRate: n ? inBand.filter((e) => e.yes).length / n : null,
    }
  })
}

export function precisionCoverage(examples: Labelled[], threshold: number) {
  const said = examples.filter((e) => e.probability >= threshold)
  const right = said.filter((e) => e.yes).length
  return {
    n: examples.length,
    answeredYes: said.length,
    right,
    precision: said.length ? right / said.length : null,
    precisionInterval: wilson(right, said.length),
    coverage: examples.length ? said.length / examples.length : 0,
  }
}

export const THRESHOLD_GRID = Array.from({ length: 10 }, (_, i) => (50 + i * 5) / 100)

// Fewer yes answers than this make the interval too wide to trust.
const MIN_YES = 10

export function pickThreshold(examples: Labelled[], { target, grid = THRESHOLD_GRID }: { target: number; grid?: number[] }): number | null {
  for (const threshold of grid) {
    const p = precisionCoverage(examples, threshold)
    if (p.answeredYes >= MIN_YES && p.precisionInterval.low >= target) return threshold
  }
  return null
}

export function splitHalves<T>(items: T[]) {
  const cut = Math.floor(items.length / 2)
  return { pick: items.slice(0, cut), report: items.slice(cut) }
}
