import type { Body, Hold, HoldRole, Route } from './types.js'

/**
 * Kilter Board（原版布局 12×12 英尺）的线路转成我们的线路格式。
 * 所有 Kilter 板的孔位坐标都一样，单位是英寸，原点在板面左下角；坐标按板面展开，
 * 最下面两排（y=4、8）是踢脚板，这里和主板面当成一个平面处理。
 */
export const INCH_CM = 2.54
/** Kilter 的岩点大小不一，没有尺寸数据，统一按这个半径算边缘距离 */
export const KILTER_HOLD_RADIUS_CM = 5
/**
 * 板面范围（英寸）：数据集是原版布局 size 10，所有线路的点都在 x 0～144、y 4～152 之内。
 * 注意数据库里每条线的 edge_* 是这条线自己的外框，不是板面边界。
 */
export const BOARD_WIDTH_IN = 144
export const BOARD_TOP_IN = 152
/** 板面顶边之上留出的高度（英寸），让 TOP 不贴着墙顶 */
const TOP_MARGIN_IN = 4

/** Kilter 原版的角色编号：12 起步、13 中间、14 结束、15 只能踩脚 */
export const KILTER_ROLES: Record<number, HoldRole> = { 12: 'start-hand', 13: 'normal', 14: 'top', 15: 'foot-only' }

export interface KilterHole {
  x: number
  y: number
  name: string
}

export interface KilterClimb {
  uuid: string
  angle: number
  name: string
  grade: string
  ascents: number
  /** 形如 p1081r15p1149r12：p 后面是放置编号，r 后面是角色编号 */
  frames: string
  isNoMatch: boolean
  betaLinks: string[]
}

export function parseFrames(frames: string): Array<{ placementId: number; roleId: number }> {
  if (!/^(p\d+r\d+)+$/.test(frames)) throw new Error(`Kilter frames 格式不对：${frames}`)
  return [...frames.matchAll(/p(\d+)r(\d+)/g)].map((m) => ({ placementId: Number(m[1]), roleId: Number(m[2]) }))
}

const cm = (inches: number) => Math.round(inches * INCH_CM * 10) / 10

/** holeOfPlacement：放置编号 → 孔位坐标 */
export function buildKilterRoute(climb: KilterClimb, holeOfPlacement: Map<number, KilterHole>, body: Body): Route {
  const placed = parseFrames(climb.frames).map(({ placementId, roleId }) => {
    const hole = holeOfPlacement.get(placementId)
    if (!hole) throw new Error(`放置编号 ${placementId} 没有孔位坐标`)
    const role = KILTER_ROLES[roleId]
    if (!role) throw new Error(`不认识的 Kilter 角色编号 ${roleId}（放置编号 ${placementId}）`)
    return { placementId, hole, role }
  })
  // 从下往上、从左往右重新编号，模型和人读起来都方便
  const ordered = [...placed].sort((a, b) => a.hole.y - b.hole.y || a.hole.x - b.hole.x)
  const holds: Hold[] = ordered.map(({ hole, role }, i) => ({ id: i + 1, x: cm(hole.x), y: cm(hole.y), r: KILTER_HOLD_RADIUS_CM, role }))
  const placementIds = Object.fromEntries(ordered.map(({ placementId }, i) => [i + 1, placementId]))

  const rules = [
    `Kilter Board 原版布局（12×12 英尺），板面 ${climb.angle}° 仰角，难度 ${climb.grade}，${climb.ascents} 人完成。`,
    '起步点（start-hand）双手起步，结束时双手停在 TOP 上；只能踩脚的点（foot-only）手不能抓。',
    climb.isNoMatch ? '这条线不允许并手：两只手不能同时在同一个点上。' : '',
    '坐标按板面展开计算，最下面两排点在踢脚板上。',
  ]
  return {
    id: `k-${climb.uuid.slice(0, 8).toLowerCase()}-${climb.angle}`,
    name: `Kilter ${climb.angle}° ${climb.name}（${climb.grade}）`,
    description: rules.filter(Boolean).join(''),
    wall: { widthCm: Math.round(BOARD_WIDTH_IN * INCH_CM), heightCm: Math.round((BOARD_TOP_IN + TOP_MARGIN_IN) * INCH_CM), angleDeg: climb.angle },
    body,
    holds,
    source: { kind: 'kilter', uuid: climb.uuid, angle: climb.angle, grade: climb.grade, ascents: climb.ascents, placementIds, betaLinks: climb.betaLinks },
  }
}
