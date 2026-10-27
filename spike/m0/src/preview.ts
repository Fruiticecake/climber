import type { Technique } from './config.js'
import type { RunLogEntry } from './runlog.js'
import type { Beta, BetaStep } from './schema.js'
import { simulate, type Frame } from './simulate.js'
import { LIMBS, type Hold, type Limb, type Route } from './types.js'
import type { Violation } from './verify.js'
import { renderViolation } from './violations.js'

/** 小人示意的比例：髋、肩在脚和手之间的位置，旗式脚相对髋的偏移（按身高） */
const HIP_RATIO = 0.42
const SHOULDER_RATIO = 0.75
const FLAG_SIDE_RATIO = 0.3
const FLAG_DROP_RATIO = 0.3
/** 没有脚点时假设脚在手下方这么远（按身高） */
const NO_FEET_DROP_RATIO = 0.6

const LIMB_NAMES: Record<Limb, string> = { LH: '左手', RH: '右手', LF: '左脚', RF: '右脚' }
const GRIP_NAMES: Record<string, string> = { pull: '正抓', 'side-pull': '侧拉', undercling: '反提', gaston: '外推', pinch: '捏', push: '下撑' }
const FOOT_NAMES: Record<string, string> = {
  front: '脚尖正踩',
  'inside-edge': '内侧边踩',
  'outside-edge': '外侧边踩',
  'heel-hook': '挂脚跟',
  'toe-hook': '勾脚尖',
  smear: '踩墙',
  flag: '旗式',
}
const HIPS_NAMES: Record<string, string> = { square: '正身', 'left-in': '左髋贴墙', 'right-in': '右髋贴墙' }
const MOTION_NAMES: Record<string, string> = { static: '静态', deadpoint: '定点', dyno: '动态跳' }

export interface Point {
  x: number
  y: number
}

/** hold：在点上；hook：挂脚；smear：踩墙（画在离开的点旁边）；flag/free：悬空（位置是示意） */
export type LimbState = 'hold' | 'hook' | 'smear' | 'flag' | 'free'

export interface PreviewLimb {
  at: Point
  hold: number | null
  state: LimbState
}

export interface PreviewStep {
  limb: Limb
  limbName: string
  target: string
  how: string
  hips: string
  motion: string
  techniques: string[]
  note: string
  why: string
  mistake: string | null
}

export interface PreviewFrame {
  index: number
  limbs: Record<Limb, PreviewLimb>
  hip: Point
  shoulder: Point
  step: PreviewStep | null
  violations: string[]
  warnings: string[]
}

export interface PreviewData {
  title: string
  subtitle: string
  summary: string
  passed: boolean
  width: number
  height: number
  holds: Array<Point & { id: number; r: number; role: Hold['role'] }>
  frames: PreviewFrame[]
}

/** 墙面 cm 坐标 → 画面坐标（y 轴向下）；有照片时对齐照片像素 */
export function makeProjection(route: Route): { toPx: (x: number, y: number) => Point; scale: number; width: number; height: number } {
  const photo = route.photo
  if (photo)
    return {
      toPx: (x, y) => ({ x: photo.originX + x * photo.pxPerCm, y: photo.originY - y * photo.pxPerCm }),
      scale: photo.pxPerCm,
      width: photo.widthPx,
      height: photo.heightPx,
    }
  return { toPx: (x, y) => ({ x, y: route.wall.heightCm - y }), scale: 1, width: route.wall.widthCm, height: route.wall.heightCm }
}

const avg = (points: Point[]): Point => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
})
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

function describeStep(step: BetaStep, techniqueNames: Map<string, string>): PreviewStep {
  const isHand = step.limb === 'LH' || step.limb === 'RH'
  const target = step.to !== null ? `#${step.to}` : (FOOT_NAMES[step.foot ?? 'smear'] ?? '离开点位')
  return {
    limb: step.limb,
    limbName: LIMB_NAMES[step.limb],
    target,
    how: isHand ? (GRIP_NAMES[step.grip ?? ''] ?? '') : (FOOT_NAMES[step.foot ?? ''] ?? ''),
    hips: HIPS_NAMES[step.hips] ?? step.hips,
    motion: MOTION_NAMES[step.motion] ?? step.motion,
    techniques: step.techniques.map((id) => techniqueNames.get(id) ?? id),
    note: step.note,
    why: step.why,
    mistake: step.commonMistake,
  }
}

/** 一帧的肢体位置和示意的髋、肩；手总在点上，脚可能踩墙或悬空 */
function placeLimbs(frame: Frame, holdPx: (id: number) => Point, bodyPx: number) {
  const located = new Map<Limb, PreviewLimb>()
  for (const limb of LIMBS) {
    const id = frame.pose[limb]
    const isFoot = limb === 'LF' || limb === 'RF'
    const tech = isFoot ? frame.footTech[limb] : null
    if (id !== null) located.set(limb, { at: holdPx(id), hold: id, state: tech === 'heel-hook' || tech === 'toe-hook' ? 'hook' : 'hold' })
    else if (isFoot && frame.smearAt[limb] !== null) located.set(limb, { at: holdPx(frame.smearAt[limb]!), hold: null, state: 'smear' })
  }
  const hands = (['LH', 'RH'] as const).map((l) => located.get(l)?.at).filter((p): p is Point => p !== undefined)
  const handsAt = avg(hands)
  const feet = (['LF', 'RF'] as const).map((l) => located.get(l)?.at).filter((p): p is Point => p !== undefined)
  const feetAt = feet.length > 0 ? avg(feet) : { x: handsAt.x, y: handsAt.y + bodyPx * NO_FEET_DROP_RATIO }
  const hip = lerp(feetAt, handsAt, HIP_RATIO)
  const shoulder = lerp(feetAt, handsAt, SHOULDER_RATIO)

  const limbs = Object.fromEntries(
    LIMBS.map((limb) => {
      const known = located.get(limb)
      if (known) return [limb, known]
      const side = limb === 'LF' ? -1 : 1
      const at = { x: hip.x + side * bodyPx * FLAG_SIDE_RATIO, y: hip.y + bodyPx * FLAG_DROP_RATIO }
      return [limb, { at, hold: null, state: frame.footTech[limb as 'LF' | 'RF'] === 'flag' ? 'flag' : 'free' }]
    }),
  ) as Record<Limb, PreviewLimb>
  return { limbs, hip, shoulder }
}

/** 把一次运行里展示的爬法变成逐帧的画面数据 */
export function buildPreviewData(route: Route, entry: RunLogEntry, techniques: Technique[]): PreviewData {
  if (!entry.best) throw new Error(`${route.id} × ${entry.modelId} 没有可展示的爬法`)
  const beta: Beta = entry.best.beta
  const { toPx, scale, width, height } = makeProjection(route)
  const byId = new Map(route.holds.map((h) => [h.id, h]))
  const holdPx = (id: number) => {
    const h = byId.get(id)
    if (!h) throw new Error(`爬法引用了线路里没有的点位 #${id}`)
    return toPx(h.x, h.y)
  }
  const techniqueNames = new Map(techniques.map((t) => [t.id, t.name]))
  const { violations, warnings } = entry.best

  const frames = simulate(beta).map((frame): PreviewFrame => ({
    index: frame.index,
    ...placeLimbs(frame, holdPx, route.body.heightCm * scale),
    step: frame.step && describeStep(frame.step, techniqueNames),
    violations: violations.filter((v) => v.step === frame.index).map((v) => renderViolation(v as Violation)),
    warnings: warnings.filter((w) => w.step === frame.index || w.steps?.includes(frame.index)).map((w) => `${w.rule}：${w.detail}`),
  }))

  return {
    title: route.name,
    subtitle: `${beta.label} · ${entry.modelId}${entry.passed ? '' : ' · 未通过校验'}`,
    summary: beta.summary,
    passed: entry.passed,
    width,
    height,
    holds: route.holds.map((h) => ({ id: h.id, ...toPx(h.x, h.y), r: h.r * scale, role: h.role })),
    frames,
  }
}
