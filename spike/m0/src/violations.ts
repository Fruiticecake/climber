import type { Limb } from './types.js'
import type { Violation } from './verify.js'

export const MAX_VIOLATIONS_IN_FEEDBACK = 5

const LIMB_NAMES: Record<Limb, string> = { LH: '左手', RH: '右手', LF: '左脚', RF: '右脚' }

const cm = (n: number | undefined) => `${Math.round(n ?? 0)}cm`

function describe(v: Violation): string {
  const [a, b] = v.limbs
  const [ha, hb] = v.holds
  const pair = a && b ? `${LIMB_NAMES[a]}（#${ha}）和${LIMB_NAMES[b]}（#${hb}）` : ''
  switch (v.rule) {
    case 'R2':
      return `${pair}相距 ${cm(v.actualCm)}，超过最大双手跨度 ${cm(v.limitCm)}`
    case 'R3':
      return `${pair}相距 ${cm(v.actualCm)}，超过最大手脚跨度 ${cm(v.limitCm)}`
    case 'R4':
      return `${pair}相距 ${cm(v.actualCm)}，超过最大双脚跨度 ${cm(v.limitCm)}`
    case 'R6':
      return `${a ? LIMB_NAMES[a] : ''}（#${ha}）比双手平均高度高出 ${cm(v.actualCm)}（上限 ${cm(v.limitCm)}），除非是挂脚跟或勾脚尖`
    case 'R7':
      return `${pair}左右交叉了，如果是有意的交叉，请在 techniques 里加上 "cross"`
    default:
      return v.detail ?? v.rule
  }
}

export function renderViolation(v: Violation): string {
  const where = v.step === 0 ? '起始姿态' : `第 ${v.step} 步`
  return `${where}（${v.rule}）：${describe(v)}。`
}

/** 给模型的修改意见：最多列 5 条，并告诉它哪些前面的步骤可以保留 */
export function renderFeedback(label: string, violations: Violation[]): string {
  const shown = violations.slice(0, MAX_VIOLATIONS_IN_FEEDBACK)
  const first = Math.min(...violations.map((v) => v.step))
  const keep =
    first <= 1 ? '请从头重新规划。' : `第 1～${first - 1} 步合法，请保留，从第 ${first} 步开始重新规划。`
  const lines = shown.map((v) => `- ${renderViolation(v)}`)
  const more = violations.length > shown.length ? [`- 另外还有 ${violations.length - shown.length} 处问题未列出`] : []
  return [`候选「${label}」：`, ...lines, ...more, keep].join('\n')
}
