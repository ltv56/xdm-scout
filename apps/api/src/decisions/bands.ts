export type Band = 'high' | 'middle' | 'low'
export interface Thresholds {
  high: number
  low: number
}

// Start values; tuned on the labelled set later.
export const DEFAULT_THRESHOLDS: Thresholds = { high: 0.7, low: 0.3 }

export function bandOf(probability: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Band {
  const { high, low } = thresholds
  if (!(low >= 0 && high <= 1 && low < high)) throw new Error(`thresholds ${low} and ${high} must satisfy 0 <= low < high <= 1`)
  if (probability >= high) return 'high'
  if (probability <= low) return 'low'
  return 'middle'
}
