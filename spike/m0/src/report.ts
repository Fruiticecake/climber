import type { Beta } from './schema.js'
import type { SolveResult } from './solve.js'
import type { Route } from './types.js'
import { renderViolation } from './violations.js'

const LIMB_NAMES = { LH: '左手', RH: '右手', LF: '左脚', RF: '右脚' } as const

export interface RunEntry {
  modelId: string
  result: SolveResult
  usd: number | null
}

const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')
const money = (usd: number | null) => (usd === null ? '未知' : `$${usd.toFixed(4)}`)

function stepsTable(beta: Beta): string {
  const head = '| # | 肢体 | 到 | 手法/脚法 | 髋 | 离墙 | 动作 | 技巧 | 做什么 | 为什么 | 新手常见错误 |\n|---|---|---|---|---|---|---|---|---|---|---|'
  const start = `| 0 | 起始 | LH#${beta.startPose.LH} RH#${beta.startPose.RH} LF#${beta.startPose.LF ?? '-'} RF#${beta.startPose.RF ?? '-'} | | | | | | ${cell(beta.summary)} | | |`
  const rows = beta.steps.map(
    (s, i) =>
      `| ${i + 1} | ${LIMB_NAMES[s.limb]} | ${s.to === null ? '-' : `#${s.to}`} | ${s.grip ?? s.foot ?? ''} | ${s.hips} | ${s.hipsToWall} | ${s.motion} | ${s.techniques.join(', ')} | ${cell(s.note)} | ${cell(s.why)} | ${cell(s.commonMistake)} |`,
  )
  return [head, start, ...rows].join('\n')
}

/** 正常结束的停止原因不写进报告，免得每次尝试都多一段 */
const NORMAL_STOP_REASONS = ['end_turn', 'stop']

function entrySection(entry: RunEntry): string {
  const { result } = entry
  const lines = [`### ${entry.modelId}`, '']
  const attempts = result.attempts.map((a) => {
    const counts = a.candidates.length > 0 ? `，各候选违规数 ${a.candidates.map((c) => c.result.violations.length).join('/')}` : ''
    const stop = a.stopReason && !NORMAL_STOP_REASONS.includes(a.stopReason) ? `，停止原因 ${a.stopReason}` : ''
    return `第 ${a.attempt} 次：${a.outcome}${stop}${a.detail ? `（${cell(a.detail)}）` : ''}${counts}`
  })
  lines.push(`尝试记录：${attempts.join('；') || '无'}`, '')
  if (!result.best) return [...lines, '没有可展示的候选。', ''].join('\n')

  const { beta, result: verdict } = result.best
  lines.push(`**展示候选：${beta.label}**（${result.passed ? '通过校验' : '未通过校验'}）`, '', stepsTable(beta), '')
  if (verdict.violations.length > 0) lines.push('违规：', ...verdict.violations.map((v) => `- ${renderViolation(v)}`), '')
  if (verdict.warnings.length > 0) lines.push('提示：', ...verdict.warnings.map((w) => `- 第 ${w.step} 步（${w.rule}）：${w.detail}`), '')
  return lines.join('\n')
}

export function buildReport(runs: Array<{ route: Route; entries: RunEntry[] }>, startedAt: Date): string {
  const parts = [
    `# M0 验证报告`,
    '',
    `运行时间：${startedAt.toLocaleString('zh-CN')}`,
    '',
    '> mock 的回复是 Claude Code 手写的样例，只用来跑通流程，不代表任何模型 API 的真实输出。',
    '',
  ]
  for (const { route, entries } of runs) {
    parts.push(
      `## ${route.name}（${route.id}）`,
      '',
      route.description,
      '',
      `墙：${route.wall.widthCm}×${route.wall.heightCm}cm，角度 ${route.wall.angleDeg}°；攀爬者：身高 ${route.body.heightCm}cm，臂展 ${route.body.armSpanCm}cm`,
      '',
      '| 模型 | 通过 | 尝试次数 | 剩余违规 | 提示 | 输入/输出 token | 费用 |',
      '|---|---|---|---|---|---|---|',
      ...entries.map((e) => {
        const remaining = e.result.best?.result.violations.length ?? '-'
        const warnings = e.result.best?.result.warnings.map((w) => w.rule).join(' ') || '-'
        return `| ${e.modelId} | ${e.result.passed ? '✅' : '❌'} | ${e.result.attempts.length} | ${remaining} | ${warnings} | ${e.result.usage.inputTokens}/${e.result.usage.outputTokens} | ${money(e.usd)} |`
      }),
      '',
      ...entries.map(entrySection),
    )
  }
  return parts.join('\n')
}
