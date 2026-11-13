import { describe, expect, it } from 'vitest'
import { calibrationFor } from './calibration'

const table = {
  'model-a': {
    measuredOn: '2026-11-14',
    byCode: {
      no_sensitive: { examples: 50, right: 49, low: 0.89, high: 1 },
      claim_backed: { examples: 40, right: 30, low: 0.6, high: 0.86 },
      one_person: { examples: 0, right: 0, low: 0, high: 1 },
    },
  },
}

describe('calibrationFor', () => {
  it('gives the measured figure of a policy question for the model that was measured', () => {
    expect(calibrationFor('model-a', 'no_sensitive', table)).toEqual({ examples: 50, right: 49, low: 0.89, high: 1, model: 'model-a', measuredOn: '2026-11-14', sample: false })
  })

  it('gives nothing for a model that was not measured', () => {
    expect(calibrationFor('model-b', 'no_sensitive', table)).toBeNull()
  })

  it('gives nothing for questions that are not policy questions, even when measured', () => {
    expect(calibrationFor('model-a', 'claim_backed', table)).toBeNull()
  })

  it('gives nothing when the model never answered yes on that question', () => {
    expect(calibrationFor('model-a', 'one_person', table)).toBeNull()
  })
})
