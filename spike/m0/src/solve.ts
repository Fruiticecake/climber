import type { Technique } from './config.js'
import { buildFormatErrorFeedback, buildRoutePrompt, buildSystemPrompt, buildViolationFeedback } from './prompt.js'
import type { ProviderUsage, SolverProvider } from './providers/types.js'
import { SolverOutputSchema, type Beta } from './schema.js'
import type { Route } from './types.js'
import { renderFeedback } from './violations.js'
import { verify, type VerifyResult } from './verify.js'

export const MAX_RETRIES = 2
export const DEFAULT_CANDIDATES = 2

export interface CandidateResult {
  beta: Beta
  result: VerifyResult
}

export interface AttemptLog {
  attempt: number
  usage: ProviderUsage
  outcome: 'passed' | 'violations' | 'format-error' | 'refusal' | 'error'
  detail?: string
  candidates: CandidateResult[]
}

export interface SolveResult {
  passed: boolean
  /** 通过校验的第一个候选；都没通过时为违规最少的候选 */
  best: CandidateResult | null
  attempts: AttemptLog[]
  usage: ProviderUsage
}

/** 从模型回复里取出 JSON：容忍代码块包裹和前后多余文字 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('回复里没有找到 JSON 对象')
  return JSON.parse(text.slice(start, end + 1))
}

type Parsed = { ok: true; betas: Beta[] } | { ok: false; error: string }

function parseReply(text: string): Parsed {
  try {
    const parsed = SolverOutputSchema.safeParse(extractJson(text))
    if (parsed.success) return { ok: true, betas: parsed.data.betas }
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)
    return { ok: false, error: issues.join('；') }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const sumUsage = (logs: AttemptLog[]): ProviderUsage => ({
  inputTokens: logs.reduce((s, l) => s + l.usage.inputTokens, 0),
  outputTokens: logs.reduce((s, l) => s + l.usage.outputTokens, 0),
})

function pickBest(candidates: CandidateResult[]): CandidateResult | null {
  return [...candidates].sort((a, b) => a.result.violations.length - b.result.violations.length)[0] ?? null
}

/** 调用模型 → 解析 → 校验；不通过就带着原因在同一个会话里重试 */
export async function solveRoute(
  route: Route,
  provider: SolverProvider,
  techniques: Technique[],
  options: { candidates?: number; maxRetries?: number } = {},
): Promise<SolveResult> {
  const candidates = options.candidates ?? DEFAULT_CANDIDATES
  const maxRetries = options.maxRetries ?? MAX_RETRIES
  const session = provider.createSession(buildSystemPrompt(techniques), route.id)
  const attempts: AttemptLog[] = []
  let message = buildRoutePrompt(route, candidates)
  let best: CandidateResult | null = null

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const zero = { inputTokens: 0, outputTokens: 0 }
    let reply
    try {
      reply = await session.send(message)
    } catch (error: unknown) {
      attempts.push({ attempt, usage: zero, outcome: 'error', detail: error instanceof Error ? error.message : String(error), candidates: [] })
      break
    }

    if (reply.stopReason === 'refusal') {
      attempts.push({ attempt, usage: reply.usage, outcome: 'refusal', candidates: [] })
      break
    }

    const parsed = parseReply(reply.text)
    if (!parsed.ok) {
      attempts.push({ attempt, usage: reply.usage, outcome: 'format-error', detail: parsed.error, candidates: [] })
      message = buildFormatErrorFeedback(parsed.error)
      continue
    }

    const results = parsed.betas.map((beta) => ({ beta, result: verify(route, beta) }))
    const passing = results.find((r) => r.result.violations.length === 0)
    if (passing) {
      attempts.push({ attempt, usage: reply.usage, outcome: 'passed', candidates: results })
      return { passed: true, best: passing, attempts, usage: sumUsage(attempts) }
    }

    attempts.push({ attempt, usage: reply.usage, outcome: 'violations', candidates: results })
    best = pickBest(results)
    message = buildViolationFeedback(results.map((r) => renderFeedback(r.beta.label, r.result.violations)))
  }

  return { passed: false, best, attempts, usage: sumUsage(attempts) }
}
