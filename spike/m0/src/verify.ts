import { deriveBody } from './body.js'
import type { Beta, Grip } from './schema.js'
import { simulate, type Frame } from './simulate.js'
import type { Body, Hold, Limb, Route } from './types.js'

// 规则阈值：初始值，等用户实测后校准
export const HAND_SPAN_FACTOR = 0.95
export const HAND_FOOT_FACTOR = 0.95
export const FOOT_SPAN_RATIO = 0.9
export const FOOT_ABOVE_HANDS_TOLERANCE_CM = 20
/** 挂脚跟、勾脚尖可以高过手，但不能比较高那只手再高出这么多，否则身体就倒过来了 */
export const HOOK_ABOVE_TOP_HAND_MAX_CM = 40
/** 普通踩点至少要比双手平均高度低身高的这个比例，否则身体压不了这么紧（170cm 约 34cm） */
export const FOOT_BELOW_HANDS_MIN_RATIO = 0.2
/** 翻上、撑上时脚可以贴近甚至略高于手 */
export const COMPRESSION_EXEMPT_TECHNIQUES = ['rock-over', 'mantle']
/** 墙角度达到这个值算明显的仰角：挂脚是常规手段 */
export const STEEP_MIN_ANGLE_DEG = 15
/** 不陡的墙上，挂脚要挂在侧面：离双手中点的水平距离、比双手平均高度低多少（按身高） */
export const HOOK_SIDE_MIN_RATIO = 0.25
export const HOOK_BELOW_HANDS_MIN_RATIO = 0.1
/** 墙角度小于这个值算正墙 */
export const SLAB_MAX_ANGLE_DEG = 0
export const CROSS_TOLERANCE_CM = 15
/** 标了 cross 也只能交叉这么远（按身高）：手大约肩宽加一截小臂，脚只能越过另一只脚一点 */
export const HAND_CROSS_MAX_RATIO = 0.3
export const FOOT_CROSS_MAX_RATIO = 0.2
export const MAX_STEPS = 40
export const TWIST_REACH_BONUS = 1.1
export const DYNAMIC_REACH_BONUS = 1.1
export const PULL_DIR_TOLERANCE_DEG = 60

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13'
export type WarningId = 'S1' | 'S3' | 'S4' | 'S5' | 'S6'

/** 侧身类技巧：正墙上很少需要 */
export const TWIST_TECHNIQUES = ['twist-lock', 'drop-knee', 'backstep']

export interface Violation {
  /** 步骤编号，0 表示起始姿态 */
  step: number
  rule: RuleId
  limbs: Limb[]
  holds: number[]
  actualCm?: number
  limitCm?: number
  detail?: string
}

export interface Warning {
  step: number
  rule: WarningId
  detail: string
  /** 涉及的全部步骤（一条提示覆盖多步时填写） */
  steps?: number[]
}

export interface VerifyResult {
  violations: Violation[]
  warnings: Warning[]
}

export interface Limits {
  handSpanCm: number
  handFootCm: number
  footSpanCm: number
  /** 普通踩点比双手平均高度至少低多少 */
  footBelowHandsMinCm: number
  /** 不陡的墙上挂脚：离双手中点至少多远、比双手平均高度至少低多少 */
  hookSideMinCm: number
  hookBelowHandsMinCm: number
  /** 有意交叉时最多交叉多远 */
  handCrossMaxCm: number
  footCrossMaxCm: number
}

export function limitsFor(body: Body): Limits {
  const dims = deriveBody(body)
  return {
    handSpanCm: body.armSpanCm * HAND_SPAN_FACTOR,
    handFootCm: (dims.shoulderHeightCm + dims.armLengthCm) * HAND_FOOT_FACTOR,
    footSpanCm: body.heightCm * FOOT_SPAN_RATIO,
    footBelowHandsMinCm: body.heightCm * FOOT_BELOW_HANDS_MIN_RATIO,
    hookSideMinCm: body.heightCm * HOOK_SIDE_MIN_RATIO,
    hookBelowHandsMinCm: body.heightCm * HOOK_BELOW_HANDS_MIN_RATIO,
    handCrossMaxCm: body.heightCm * HAND_CROSS_MAX_RATIO,
    footCrossMaxCm: body.heightCm * FOOT_CROSS_MAX_RATIO,
  }
}

/** 两个岩点边缘之间的距离 */
export function edgeDistance(a: Hold, b: Hold): number {
  if (a.id === b.id) return 0
  return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r)
}

/**
 * 当前这一帧里，某只手的伸展上限倍率。
 * 髋贴墙一侧的手负责锁定，对侧的手可以够得更远（扭转、落膝）；定点和动态也能多够一截。
 */
function reachBonus(frame: Frame, hand: 'LH' | 'RH'): number {
  const step = frame.step
  if (!step) return 1
  const twisted = (step.hips === 'left-in' && hand === 'RH') || (step.hips === 'right-in' && hand === 'LH')
  const dynamic = step.motion === 'dyno' || step.motion === 'deadpoint'
  return Math.max(twisted ? TWIST_REACH_BONUS : 1, dynamic ? DYNAMIC_REACH_BONUS : 1)
}

function checkReferences(route: Route, beta: Beta, byId: Map<number, Hold>): Violation[] {
  const unknown = (id: number | null) => id !== null && !byId.has(id)
  const out: Violation[] = []
  const startIds = Object.values(beta.startPose)
  startIds.filter(unknown).forEach((id) =>
    out.push({ step: 0, rule: 'R1', limbs: [], holds: [id!], detail: `起始姿态引用了不存在的点位 #${id}` }),
  )
  beta.steps.forEach((s, i) => {
    if (unknown(s.to)) out.push({ step: i + 1, rule: 'R1', limbs: [s.limb], holds: [s.to!], detail: `引用了不存在的点位 #${s.to}` })
  })
  if (out.length > 0) return out

  const startHands = route.holds.filter((h) => h.role === 'start-hand').map((h) => h.id)
  const used = new Set([beta.startPose.LH, beta.startPose.RH])
  const handsOnStart = [...used].every((id) => startHands.includes(id))
  const allStartsUsed = startHands.every((id) => used.has(id))
  if (!handsOnStart || !allStartsUsed) {
    out.push({
      step: 0,
      rule: 'R1',
      limbs: ['LH', 'RH'],
      holds: [beta.startPose.LH, beta.startPose.RH],
      detail: `起始姿态双手必须在起点手点 ${startHands.map((id) => `#${id}`).join('、')} 上`,
    })
  }
  return out
}

function checkEnd(route: Route, frames: Frame[]): Violation[] {
  const last = frames[frames.length - 1]!
  const tops = new Set(route.holds.filter((h) => h.role === 'top').map((h) => h.id))
  const { LH, RH } = last.pose
  if (LH !== null && RH !== null && tops.has(LH) && tops.has(RH)) return []
  return [{ step: last.index, rule: 'R1', limbs: ['LH', 'RH'], holds: [LH ?? -1, RH ?? -1], detail: '结束时双手都要在 TOP 上停稳' }]
}

/**
 * 已经靠技巧（扭转、定点、交叉等）达成的姿态：只要相关肢体还在原来的点上，后面几步继续允许。
 * 键是 "规则|肢体|点位"，值是当时用的伸展倍率（交叉为 1）。
 */
type Stretched = Map<string, number>

interface FrameCheck {
  violations: Violation[]
  stretched: Stretched
}

/** 整条线路不变的检查条件 */
interface RouteContext {
  byId: Map<number, Hold>
  limits: Limits
  wallAngleDeg: number
}

/** 单帧的几何检查（R2、R3、R4、R6、R7、R11、R12） */
function checkFrame(frame: Frame, ctx: RouteContext, carried: Stretched, nextTechniques: string[]): FrameCheck {
  const { byId, limits } = ctx
  const { pose } = frame
  const out: Violation[] = []
  const stretched: Stretched = new Map()
  const hold = (id: number | null) => (id === null ? null : (byId.get(id) ?? null))
  const lh = hold(pose.LH)
  const rh = hold(pose.RH)
  const lf = hold(pose.LF)
  const rf = hold(pose.RF)
  const techniques = frame.step?.techniques ?? []
  // 跨度检查用的脚位置：踩墙的脚按它离开的点算，避免靠踩墙把脚"传送"走
  const lfAt = lf ?? hold(frame.smearAt.LF)
  const rfAt = rf ?? hold(frame.smearAt.RF)
  const smearDetail = (limbs: Limb[]) =>
    limbs.some((l) => (l === 'LF' && !lf && lfAt) || (l === 'RF' && !rf && rfAt)) ? { detail: 'smear' } : {}

  const checkReach = (rule: 'R2' | 'R3', limbs: Limb[], a: Hold, b: Hold, base: number, frameBonus: number) => {
    const key = `${rule}|${limbs.join(',')}|${a.id},${b.id}`
    const bonus = Math.max(frameBonus, carried.get(key) ?? 1)
    const d = edgeDistance(a, b)
    const limit = base * bonus
    if (d > limit) out.push({ step: frame.index, rule, limbs, holds: [a.id, b.id], actualCm: d, limitCm: limit, ...smearDetail(limbs) })
    else if (d > base) stretched.set(key, bonus)
  }

  // 交叉：标了 cross 的那一步允许交叉，之后两个点都不变时继续允许；但超过幅度上限时标了也不行
  const checkCross = (limbs: Limb[], left: Hold, right: Hold, maxCm: number) => {
    const amount = left.x - right.x
    if (amount <= CROSS_TOLERANCE_CM) return
    const holds = [left.id, right.id]
    if (amount > maxCm) {
      out.push({ step: frame.index, rule: 'R7', limbs, holds, actualCm: amount, limitCm: maxCm, detail: 'too-far' })
      return
    }
    const key = `R7|${limbs.join(',')}|${left.id},${right.id}`
    if (techniques.includes('cross') || carried.has(key)) stretched.set(key, 1)
    else out.push({ step: frame.index, rule: 'R7', limbs, holds })
  }

  if (lh && rh) {
    checkReach('R2', ['LH', 'RH'], lh, rh, limits.handSpanCm, Math.max(reachBonus(frame, 'LH'), reachBonus(frame, 'RH')))
    checkCross(['LH', 'RH'], lh, rh, limits.handCrossMaxCm)
  }

  const hands: Array<['LH' | 'RH', Hold | null]> = [['LH', lh], ['RH', rh]]
  const feet: Array<['LF' | 'RF', Hold | null]> = [['LF', lf], ['RF', rf]]
  const feetAt: Array<['LF' | 'RF', Hold | null]> = [['LF', lfAt], ['RF', rfAt]]
  for (const [handLimb, h] of hands) {
    for (const [footLimb, f] of feetAt) {
      if (h && f) checkReach('R3', [handLimb, footLimb], h, f, limits.handFootCm, reachBonus(frame, handLimb))
    }
  }

  if (lfAt && rfAt) {
    const d = edgeDistance(lfAt, rfAt)
    if (d > limits.footSpanCm)
      out.push({ step: frame.index, rule: 'R4', limbs: ['LF', 'RF'], holds: [lfAt.id, rfAt.id], actualCm: d, limitCm: limits.footSpanCm, ...smearDetail(['LF', 'RF']) })
  }
  if (lf && rf) checkCross(['LF', 'RF'], lf, rf, limits.footCrossMaxCm)

  if (lh && rh) {
    const handsY = (lh.y + rh.y) / 2
    const topHandY = Math.max(lh.y, rh.y)
    for (const [footLimb, f] of feet) {
      if (!f) continue
      const tech = frame.footTech[footLimb]
      const hooked = tech === 'heel-hook' || tech === 'toe-hook'
      const tooHigh = !hooked && f.y - handsY > FOOT_ABOVE_HANDS_TOLERANCE_CM
      if (tooHigh)
        out.push({ step: frame.index, rule: 'R6', limbs: [footLimb], holds: [f.id], actualCm: f.y - handsY, limitCm: FOOT_ABOVE_HANDS_TOLERANCE_CM })
      // 已经高过手的脚只报 R6。翻上、撑上那一步，以及紧接着要翻上的上脚那一步，允许压紧；这只脚不动时之后继续允许
      const gap = handsY - f.y
      const key = `R11|${footLimb}|${f.id}`
      if (!hooked && !tooHigh && gap < limits.footBelowHandsMinCm) {
        const exempt = [...techniques, ...nextTechniques].some((t) => COMPRESSION_EXEMPT_TECHNIQUES.includes(t))
        if (exempt || carried.has(key)) stretched.set(key, 1)
        else out.push({ step: frame.index, rule: 'R11', limbs: [footLimb], holds: [f.id], actualCm: gap, limitCm: limits.footBelowHandsMinCm })
      }
      if (hooked && f.y - topHandY > HOOK_ABOVE_TOP_HAND_MAX_CM)
        out.push({
          step: frame.index,
          rule: 'R6',
          limbs: [footLimb],
          holds: [f.id],
          actualCm: f.y - topHandY,
          limitCm: HOOK_ABOVE_TOP_HAND_MAX_CM,
          detail: 'hook',
        })
    }
    const cappedHooks = new Set(out.filter((v) => v.rule === 'R6' && v.detail === 'hook').map((v) => v.limbs[0]))
    out.push(...checkHookPlacement(frame, ctx, lh, rh, feet.filter(([l]) => !cappedHooks.has(l))))
  }
  return { violations: out, stretched }
}

const cmText = (n: number) => `${Math.round(n)}cm`

/**
 * R12：不陡的墙上，挂脚跟、勾脚尖要挂在身体侧面、比手低，靠侧向拉力把身体拉向墙；
 * 挂在手旁边或手上方的挂脚没有东西可拉，只是把脚放高的借口。陡墙上不限制（只有 R6 的高度上限）。
 */
function checkHookPlacement(frame: Frame, ctx: RouteContext, lh: Hold, rh: Hold, feet: Array<['LF' | 'RF', Hold | null]>): Violation[] {
  const { limits, wallAngleDeg } = ctx
  if (wallAngleDeg >= STEEP_MIN_ANGLE_DEG) return []
  const handsX = (lh.x + rh.x) / 2
  const handsY = (lh.y + rh.y) / 2
  const out: Violation[] = []
  for (const [footLimb, f] of feet) {
    const tech = frame.footTech[footLimb]
    if (!f || (tech !== 'heel-hook' && tech !== 'toe-hook')) continue
    const side = Math.abs(f.x - handsX)
    const below = handsY - f.y
    if (side >= limits.hookSideMinCm && below >= limits.hookBelowHandsMinCm) continue
    const now = below >= 0 ? `现在 ${cmText(below)}` : `现在反而高出 ${cmText(-below)}`
    out.push({
      step: frame.index,
      rule: 'R12',
      limbs: [footLimb],
      holds: [f.id],
      actualCm: side,
      limitCm: limits.hookSideMinCm,
      detail: `挂脚：墙只有 ${wallAngleDeg}°，不算陡，挂脚要挂在身体侧面——离双手中点水平至少 ${cmText(limits.hookSideMinCm)}（现在 ${cmText(side)}），并且比双手平均高度至少低 ${cmText(limits.hookBelowHandsMinCm)}（${now}）；否则改成普通踩点，或者先把手移开、移高再挂`,
    })
  }
  return out
}

/** 步骤本身的合法性（R5、R8、R9、R10、R13） */
function checkStep(frames: Frame[], i: number, byId: Map<number, Hold>): Violation[] {
  const frame = frames[i]!
  const prev = frames[i - 1]!
  const step = frame.step!
  const out: Violation[] = []
  const isHand = step.limb === 'LH' || step.limb === 'RH'

  if (step.to === null && (isHand || (step.foot !== 'smear' && step.foot !== 'flag')))
    out.push({ step: i, rule: 'R5', limbs: [step.limb], holds: [], detail: isHand ? '手必须落在点上' : '脚离开点位时要标明 smear 或 flag' })

  if (isHand && step.to !== null && byId.get(step.to)?.role === 'foot-only')
    out.push({ step: i, rule: 'R13', limbs: [step.limb], holds: [step.to], detail: `#${step.to} 是只能踩脚的点，手不能抓` })

  if (step.to !== null && prev.pose[step.limb] === step.to)
    out.push({ step: i, rule: 'R8', limbs: [step.limb], holds: [step.to], detail: '这一步没有移动' })

  const key = JSON.stringify(frame.pose)
  if (frames.slice(0, i).some((f) => JSON.stringify(f.pose) === key))
    out.push({ step: i, rule: 'R8', limbs: [step.limb], holds: [], detail: '回到了之前出现过的姿态' })

  // 手和脚不能同时在一个点上：手离开之后脚才能踩上去（翻上、撑上时除外）
  if (step.to !== null) {
    const others = (isHand ? ['LF', 'RF'] : ['LH', 'RH']) as Limb[]
    const sharing = others.filter((l) => frame.pose[l] === step.to)
    const allowed = step.techniques.includes('rock-over') || step.techniques.includes('mantle')
    if (sharing.length > 0 && !allowed)
      out.push({ step: i, rule: 'R10', limbs: [step.limb, ...sharing], holds: [step.to], detail: `#${step.to} 上已经有${isHand ? '脚' : '手'}了` })
  }

  if (step.foot === 'flag' && step.to === null) {
    const other = step.limb === 'LF' ? 'RF' : 'LF'
    if (frame.pose[other] === null)
      out.push({ step: i, rule: 'R9', limbs: [step.limb, other], holds: [], detail: '旗式时另一只脚必须踩在点上做支撑' })
  }
  return out
}

const EXPECTED_PULL_DIRS: Partial<Record<Grip, number[]>> = {
  pull: [0],
  'side-pull': [90, 270],
  gaston: [90, 270],
  undercling: [180],
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

/** S5：正墙上大量使用侧身类技巧。整套爬法只给一条提示，列出涉及的步骤 */
function slabTwistWarning(route: Route, frames: Frame[]): Warning[] {
  if (route.wall.angleDeg >= SLAB_MAX_ANGLE_DEG) return []
  const twisted = frames
    .slice(1)
    .filter((f) => f.step!.hips !== 'square' || f.step!.techniques.some((t) => TWIST_TECHNIQUES.includes(t)))
    .map((f) => f.index)
  if (twisted.length === 0) return []
  return [
    {
      step: twisted[0]!,
      steps: twisted,
      rule: 'S5',
      detail: `正墙（${route.wall.angleDeg}°）上第 ${twisted.join('、')} 步用了侧身或扭转；正墙通常正身站立，靠踩墙、高脚和重心平移，确认这些步骤真的需要侧身`,
    },
  ]
}

/** 这一帧里左右手或左右脚是否交叉（超过容差） */
function isCrossed(frame: Frame, byId: Map<number, Hold>): boolean {
  const x = (id: number | null) => (id === null ? undefined : byId.get(id)?.x)
  const pairs: Array<[number | undefined, number | undefined]> = [
    [x(frame.pose.LH), x(frame.pose.RH)],
    [x(frame.pose.LF), x(frame.pose.RF)],
  ]
  return pairs.some(([l, r]) => l !== undefined && r !== undefined && l - r > CROSS_TOLERANCE_CM)
}

/** S6：标了 cross 但这一步手脚都没有交叉。整套爬法只给一条提示，列出涉及的步骤 */
function crossTagWarning(frames: Frame[], byId: Map<number, Hold>): Warning[] {
  const tagged = frames
    .slice(1)
    .filter((f) => f.step!.techniques.includes('cross') && !isCrossed(f, byId))
    .map((f) => f.index)
  if (tagged.length === 0) return []
  return [{ step: tagged[0]!, steps: tagged, rule: 'S6', detail: `第 ${tagged.join('、')} 步标了 cross，但这一步手和脚都没有交叉；cross 只在确实交叉时写` }]
}

function collectWarnings(route: Route, frames: Frame[], byId: Map<number, Hold>): Warning[] {
  const out: Warning[] = [...slabTwistWarning(route, frames), ...crossTagWarning(frames, byId)]
  frames.slice(1).forEach((frame, k) => {
    const prev = frames[k]!
    const step = frame.step!
    const isHand = step.limb === 'LH' || step.limb === 'RH'
    if (isHand && prev.pose.LF === null && prev.pose.RF === null)
      out.push({ step: frame.index, rule: 'S1', detail: '无脚移动手（campus），很费力' })
    if (step.motion !== 'static')
      out.push({ step: frame.index, rule: 'S3', detail: step.motion === 'dyno' ? '动态，需要爆发力' : '定点，需要发力并精准抓点' })
    const target = step.to === null ? undefined : byId.get(step.to)
    const expected = step.grip ? EXPECTED_PULL_DIRS[step.grip] : undefined
    if (isHand && target?.pullDirDeg !== undefined && expected) {
      const best = Math.min(...expected.map((e) => angleDiff(e, target.pullDirDeg!)))
      if (best > PULL_DIR_TOLERANCE_DEG)
        out.push({ step: frame.index, rule: 'S4', detail: `#${target.id} 的受力方向是 ${target.pullDirDeg}°，和 ${step.grip} 不太吻合` })
    }
  })
  return out
}

const violationKey = (v: Violation) => `${v.rule}|${v.limbs.join(',')}|${v.holds.join(',')}`

export function verify(route: Route, beta: Beta): VerifyResult {
  const byId = new Map(route.holds.map((h) => [h.id, h]))
  const refs = checkReferences(route, beta, byId)
  if (refs.some((v) => v.detail?.includes('不存在'))) return { violations: refs, warnings: [] }

  const limits = limitsFor(route.body)
  const frames = simulate(beta)
  const violations: Violation[] = [...refs]

  // 每一帧做完整检查，但只报告新出现的违规，避免同一个问题在后面每一步重复出现
  let prevKeys = new Set<string>()
  let stretched: Stretched = new Map()
  frames.forEach((frame, i) => {
    const check = checkFrame(frame, { byId, limits, wallAngleDeg: route.wall.angleDeg }, stretched, frames[i + 1]?.step?.techniques ?? [])
    violations.push(...check.violations.filter((v) => !prevKeys.has(violationKey(v))))
    prevKeys = new Set(check.violations.map(violationKey))
    stretched = check.stretched
    if (i > 0) violations.push(...checkStep(frames, i, byId))
  })

  if (beta.steps.length > MAX_STEPS)
    violations.push({ step: beta.steps.length, rule: 'R8', limbs: [], holds: [], detail: `总步数 ${beta.steps.length} 超过上限 ${MAX_STEPS}` })
  violations.push(...checkEnd(route, frames))

  return {
    violations: [...violations].sort((a, b) => a.step - b.step),
    warnings: [...collectWarnings(route, frames, byId)].sort((a, b) => a.step - b.step),
  }
}
