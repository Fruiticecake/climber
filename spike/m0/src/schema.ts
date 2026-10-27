import { z } from 'zod'
import { HOLD_ROLES, HOLD_TYPES, LIMBS } from './types.js'

export const GRIPS = ['pull', 'side-pull', 'undercling', 'gaston', 'pinch', 'push'] as const
export const FOOT_TECHS = ['front', 'inside-edge', 'outside-edge', 'heel-hook', 'toe-hook', 'smear', 'flag'] as const
export const HIPS = ['square', 'left-in', 'right-in'] as const
export const HIPS_TO_WALL = ['close', 'normal', 'far'] as const
export const MOTIONS = ['static', 'deadpoint', 'dyno'] as const

export type Grip = (typeof GRIPS)[number]
export type FootTech = (typeof FOOT_TECHS)[number]

const holdRef = z.number().int()

export const PoseSchema = z.object({
  LH: holdRef,
  RH: holdRef,
  LF: holdRef.nullable(),
  RF: holdRef.nullable(),
})

export const BetaStepSchema = z.object({
  limb: z.enum(LIMBS),
  to: holdRef.nullable(),
  grip: z.enum(GRIPS).nullable(),
  foot: z.enum(FOOT_TECHS).nullable(),
  hips: z.enum(HIPS),
  hipsToWall: z.enum(HIPS_TO_WALL),
  motion: z.enum(MOTIONS),
  techniques: z.array(z.string()),
  note: z.string(),
  why: z.string(),
  commonMistake: z.string().nullable(),
})

export const BetaSchema = z.object({
  label: z.string(),
  summary: z.string(),
  startPose: PoseSchema,
  startFeet: z.object({ LF: z.enum(FOOT_TECHS).nullable(), RF: z.enum(FOOT_TECHS).nullable() }),
  steps: z.array(BetaStepSchema).min(1),
})

export const SolverOutputSchema = z.object({
  betas: z.array(BetaSchema).min(1),
})

export type BetaStep = z.infer<typeof BetaStepSchema>
export type Beta = z.infer<typeof BetaSchema>
export type SolverOutput = z.infer<typeof SolverOutputSchema>

export const RouteSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  wall: z.object({ widthCm: z.number().positive(), heightCm: z.number().positive(), angleDeg: z.number() }),
  body: z.object({ heightCm: z.number().positive(), armSpanCm: z.number().positive() }),
  holds: z.array(
    z.object({
      id: z.number().int(),
      x: z.number(),
      y: z.number(),
      r: z.number().positive(),
      role: z.enum(HOLD_ROLES),
      type: z.enum(HOLD_TYPES).optional(),
      pullDirDeg: z.number().optional(),
    }),
  ),
  photo: z
    .object({
      file: z.string(),
      widthPx: z.number().positive(),
      heightPx: z.number().positive(),
      pxPerCm: z.number().positive(),
      originX: z.number(),
      originY: z.number(),
    })
    .optional(),
})
