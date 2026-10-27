export const LIMBS = ['LH', 'RH', 'LF', 'RF'] as const
export type Limb = (typeof LIMBS)[number]

export const HOLD_ROLES = ['start-hand', 'start-foot', 'top', 'normal'] as const
export const HOLD_TYPES = ['jug', 'crimp', 'sloper', 'pinch', 'pocket', 'volume'] as const

export interface Hold {
  id: number
  /** 墙面坐标，单位 cm，原点在墙面左下角，y 轴向上 */
  x: number
  y: number
  r: number
  role: (typeof HOLD_ROLES)[number]
  type?: (typeof HOLD_TYPES)[number]
  /** 受力方向：0 往下拉，90 往右侧拉，180 反提，270 往左侧拉 */
  pullDirDeg?: number
}

export interface Body {
  heightCm: number
  armSpanCm: number
}

export interface Wall {
  widthCm: number
  heightCm: number
  /** 负数正墙（slab），0 直墙，正数仰角 */
  angleDeg: number
}

/**
 * 线路坐标和照片像素的对应关系（只用于预览，不交给模型）：
 * 像素 x = originX + x × pxPerCm，像素 y = originY − y × pxPerCm
 */
export interface RoutePhoto {
  /** 相对 spike/m0 的路径；照片不一定在仓库里 */
  file: string
  widthPx: number
  heightPx: number
  pxPerCm: number
  originX: number
  originY: number
}

export interface Route {
  id: string
  name: string
  /** 给人看的说明，也会原样交给模型 */
  description: string
  wall: Wall
  body: Body
  holds: Hold[]
  photo?: RoutePhoto
}

/** 每个肢体所在的点位 id；脚为 null 表示踩墙或悬空 */
export type Pose = Record<Limb, number | null>
