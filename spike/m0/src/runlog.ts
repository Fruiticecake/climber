import { z } from 'zod'
import type { RunEntry } from './report.js'
import { BetaSchema } from './schema.js'
import type { Route } from './types.js'

/**
 * 每次运行的机器可读结果，和 Markdown 报告放在一起。
 * 只存线路 id，线路本身以 routes/ 下的文件为准。
 */
const ViolationSchema = z.object({
  step: z.number(),
  rule: z.string(),
  limbs: z.array(z.string()),
  holds: z.array(z.number()),
  actualCm: z.number().optional(),
  limitCm: z.number().optional(),
  detail: z.string().optional(),
})

const WarningSchema = z.object({
  step: z.number(),
  rule: z.string(),
  detail: z.string(),
  steps: z.array(z.number()).optional(),
})

const RunLogEntrySchema = z.object({
  modelId: z.string(),
  passed: z.boolean(),
  usd: z.number().nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  attempts: z.array(
    z.object({ attempt: z.number(), outcome: z.string(), stopReason: z.string().nullable(), detail: z.string().optional() }),
  ),
  best: z.object({ beta: BetaSchema, violations: z.array(ViolationSchema), warnings: z.array(WarningSchema) }).nullable(),
})

export const RunLogSchema = z.object({
  startedAt: z.string(),
  runs: z.array(z.object({ routeId: z.string(), entries: z.array(RunLogEntrySchema) })),
})

export type RunLog = z.infer<typeof RunLogSchema>
export type RunLogEntry = z.infer<typeof RunLogEntrySchema>

export function buildRunLog(runs: Array<{ route: Route; entries: RunEntry[] }>, startedAt: Date): RunLog {
  return {
    startedAt: startedAt.toISOString(),
    runs: runs.map(({ route, entries }) => ({
      routeId: route.id,
      entries: entries.map(({ modelId, result, usd }) => ({
        modelId,
        passed: result.passed,
        usd,
        usage: result.usage,
        attempts: result.attempts.map(({ attempt, outcome, stopReason, detail }) => ({ attempt, outcome, stopReason, ...(detail && { detail }) })),
        best: result.best && { beta: result.best.beta, violations: result.best.result.violations, warnings: result.best.result.warnings },
      })),
    })),
  }
}

/** 读回运行结果；文件是外部数据，按 schema 校验 */
export function parseRunLog(text: string): RunLog {
  return RunLogSchema.parse(JSON.parse(text))
}
