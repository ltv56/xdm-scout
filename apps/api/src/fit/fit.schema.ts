import { z } from 'zod'

export const FIT_LABELS = ['strong', 'possible', 'weak', 'not_a_fit'] as const
export const ROLES = ['builder', 'founder', 'researcher', 'other'] as const
export const AREAS = ['models', 'applications', 'developer_tools', 'infrastructure', 'robotics', 'embodied_ai'] as const
export const OPENING_TYPES = ['launch', 'paper', 'question', 'hiring', 'milestone', 'none'] as const

const claim = z.object({ claim: z.string().min(1), evidence_ids: z.array(z.string()) })

export const fitSchema = z.object({
  role: z.enum(ROLES),
  areas: z.array(z.enum(AREAS)),
  fit: z.enum(FIT_LABELS),
  reasons_for: z.array(claim),
  reasons_against: z.array(claim),
  unknowns: z.array(z.string()),
  opening: z.object({
    type: z.enum(OPENING_TYPES),
    summary: z.string(),
    evidence_id: z.string().nullable(),
    date: z.string().nullable(),
  }),
  criteria: z.array(z.object({ status: z.enum(['met', 'not_met', 'unknown']), evidence_ids: z.array(z.string()) })).default([]),
})

export const verifySchema = z.object({ supported: z.boolean() })

export type FitResult = z.infer<typeof fitSchema>
export type FitLabel = (typeof FIT_LABELS)[number]
