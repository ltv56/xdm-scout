import { Decision } from '../review/contract'
import { DecisionCode } from './decision-client'
import measured from './calibration.json'

export type CalibrationTable = Record<string, { measuredOn: string; byCode: Partial<Record<DecisionCode, { examples: number; right: number; low: number; high: number }>> }>

// Only the draft policy questions carry a measurement; the rest are shown without one.
const POLICY: DecisionCode[] = ['no_sensitive', 'no_familiarity', 'one_person']

// The table is written by `node scripts/eval.cjs --model <name> --write-calibration` from the second half of the labelled fixtures.
export function calibrationFor(model: string, code: DecisionCode, table: CalibrationTable = measured as CalibrationTable): Decision['calibration'] {
  const entry = table[model]
  const figure = POLICY.includes(code) ? entry?.byCode[code] : undefined
  if (!entry || !figure || figure.examples === 0) return null
  return { ...figure, model, measuredOn: entry.measuredOn, sample: false }
}
