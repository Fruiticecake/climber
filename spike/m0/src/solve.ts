import type { Technique } from './config.js'
import {
  buildFormatErrorFeedback,
  buildQualityFeedback,
  buildRoutePrompt,
  buildSystemPrompt,
  buildViolationFeedback,
} from './prompt.js'
import type { ProviderUsage, SolverProvider } from './providers/types.js'
import { SolverOutputSchema, type Beta } from './schema.js'
import type { Route } from './types.js'
import { renderFeedback } from './violations.js'
import { verify, type VerifyResult, type WarningId } from './verify.js'

export const MAX_RETRIES = 2
export const MAX_QUALITY_RETRIES = 1
export const DEFAULT_CANDIDATES = 2
/** 硬规则都通过后，这些提示还会触发质量重试 */
export const QUALITY_RULES: WarningId[] = ['S5']

export interface CandidateResult {
  beta: Beta
  result: VerifyResult
}

export interface AttemptLog {
  attempt: number
  usage: ProviderUsage
  /** quality-retry：硬规则通过，但有质量提示，要求模型再改一次 */
  outcome: 'passed' | 'quality-retry' | 'violations' | 'format-error' | 'refusal' | 'error'
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

/** 质量问题的严重程度：按涉及的步骤数计 */
export function qualityScore(c: CandidateResult): number {
  return c.result.warnings
    .filter((w) => QUALITY_RULES.includes(w.rule))
    .reduce((sum, w) => sum + (w.steps?.length ?? 1), 0)
}

/** 质量问题最少的候选；一样时取排在前面的（模型更推荐的） */
function pickByQuality(candidates: CandidateResult[]): CandidateResult | null {
  return candidates.reduce<CandidateResult | null>((best, c) => (best === null || qualityScore(c) < qualityScore(best) ? c : best), null)
}

export interface SolveOptions {
  candidates?: number
  maxRetries?: number
  maxQualityRetries?: number
}

/**
 * 调用模型 → 解析 → 校验。
 * 不通过硬规则：带着违规原因在同一个会话里重试，最多 maxRetries 次。
 * 通过了但有质量提示：再要求改一次，最多 maxQualityRetries 次；改坏了就用之前通过的那个。
 */
export async function solveRoute(
  route: Route,
  provider: SolverProvider,
  techniques: Technique[],
  options: SolveOptions = {},
): Promise<SolveResult> {
  const candidates = options.candidates ?? DEFAULT_CANDIDATES
  const maxRetries = options.maxRetries ?? MAX_RETRIES
  let qualityRetriesLeft = options.maxQualityRetries ?? MAX_QUALITY_RETRIES
  const session = provider.createSession(buildSystemPrompt(techniques), route.id)
  const attempts: AttemptLog[] = []
  let message = buildRoutePrompt(route, candidates)
  let best: CandidateResult | null = null
  let passedEarlier: CandidateResult | null = null
  let hardFailures = 0

  const done = (): SolveResult => ({
    passed: passedEarlier !== null,
    best: passedEarlier ?? best,
    attempts,
    usage: sumUsage(attempts),
  })

  for (let attempt = 1; ; attempt++) {
    let reply
    try {
      reply = await session.send(message)
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      attempts.push({ attempt, usage: { inputTokens: 0, outputTokens: 0 }, outcome: 'error', detail, candidates: [] })
      return done()
    }

    if (reply.stopReason === 'refusal') {
      attempts.push({ attempt, usage: reply.usage, outcome: 'refusal', candidates: [] })
      return done()
    }

    const parsed = parseReply(reply.text)
    if (!parsed.ok) {
      attempts.push({ attempt, usage: reply.usage, outcome: 'format-error', detail: parsed.error, candidates: [] })
      if (passedEarlier || ++hardFailures > maxRetries) return done()
      message = buildFormatErrorFeedback(parsed.error)
      continue
    }

    const results = parsed.betas.map((beta) => ({ beta, result: verify(route, beta) }))
    const passing = results.filter((r) => r.result.violations.length === 0)

    if (passing.length === 0) {
      attempts.push({ attempt, usage: reply.usage, outcome: 'violations', candidates: results })
      best = pickBest(results)
      // 质量重试把爬法改坏了：不再纠缠，用之前通过的那个
      if (passedEarlier || ++hardFailures > maxRetries) return done()
      message = buildViolationFeedback(results.map((r) => renderFeedback(r.beta.label, r.result.violations)))
      continue
    }

    const previous: CandidateResult | null = passedEarlier
    // 新候选排在前面：质量一样时优先用改过的
    const candidate: CandidateResult = pickByQuality(previous ? [...passing, previous] : passing)!
    passedEarlier = candidate
    if (qualityScore(candidate) === 0 || qualityRetriesLeft === 0) {
      const detail = previous && candidate === previous ? '改后质量没有变好，保留上一次的候选' : undefined
      attempts.push({ attempt, usage: reply.usage, outcome: 'passed', detail, candidates: results })
      return done()
    }

    qualityRetriesLeft -= 1
    const issues = candidate.result.warnings.filter((w) => QUALITY_RULES.includes(w.rule)).map((w) => w.detail)
    attempts.push({ attempt, usage: reply.usage, outcome: 'quality-retry', candidates: results })
    message = buildQualityFeedback(candidate.beta.label, issues)
  }
}
