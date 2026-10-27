import { describe, expect, it } from 'vitest'
import { buildKilterRoute, parseFrames, type KilterClimb, type KilterHole } from '../src/kilter.js'
import { RouteSchema } from '../src/schema.js'

// 一条最小的 Kilter 线：起步 #1149，中间 #1198，TOP #1385，脚点 #1081（踢脚板）
const holes = new Map<number, KilterHole>([
  [1149, { x: 72, y: 40, name: '18,10' }],
  [1198, { x: 56, y: 88, name: '14,22' }],
  [1385, { x: 64, y: 152, name: '16,38' }],
  [1081, { x: 48, y: 8, name: '12,KB2' }],
])

const climb: KilterClimb = {
  uuid: 'BF0DB71D0D674289BEEF46E226216BF6',
  angle: 40,
  name: 'Sour Gummi Worms',
  grade: '5c/V2',
  ascents: 36384,
  frames: 'p1081r15p1149r12p1198r13p1385r14',
  isNoMatch: false,
  betaLinks: ['https://www.instagram.com/p/x/'],
}

describe('parseFrames', () => {
  it('拆出每个点的放置编号和角色编号', () => {
    expect(parseFrames('p1081r15p1149r12')).toEqual([
      { placementId: 1081, roleId: 15 },
      { placementId: 1149, roleId: 12 },
    ])
  })

  it('格式不对时报错', () => {
    expect(() => parseFrames('p1081x15')).toThrow('frames')
  })
})

describe('buildKilterRoute', () => {
  const route = buildKilterRoute(climb, holes, { heightCm: 170, armSpanCm: 172 })

  it('生成的线路符合线路格式；墙是整块板面，不是这条线的外框', () => {
    expect(RouteSchema.safeParse(route).success).toBe(true)
    expect(route.id).toBe('k-bf0db71d-40')
    expect(route.wall).toEqual({ widthCm: 366, heightCm: 396, angleDeg: 40 })
  })

  it('英寸换成厘米，从下往上重新编号，角色对上', () => {
    expect(route.holds).toEqual([
      { id: 1, x: 121.9, y: 20.3, r: 5, role: 'foot-only' },
      { id: 2, x: 182.9, y: 101.6, r: 5, role: 'start-hand' },
      { id: 3, x: 142.2, y: 223.5, r: 5, role: 'normal' },
      { id: 4, x: 162.6, y: 386.1, r: 5, role: 'top' },
    ])
  })

  it('说明写清来源、角度、难度和规则，来源信息里保留原始编号和视频链接', () => {
    expect(route.description).toContain('Kilter Board')
    expect(route.description).toContain('40°')
    expect(route.description).toContain('5c/V2')
    expect(route.description).not.toContain('不允许并手')
    expect(route.source).toMatchObject({ kind: 'kilter', uuid: climb.uuid, angle: 40, placementIds: { 1: 1081, 2: 1149, 3: 1198, 4: 1385 } })
    expect(route.source!.betaLinks).toEqual(climb.betaLinks)
  })

  it('不允许并手的线写进说明', () => {
    expect(buildKilterRoute({ ...climb, isNoMatch: true }, holes, { heightCm: 170, armSpanCm: 172 }).description).toContain('不允许并手')
  })

  it('引用了没有坐标的点时报错', () => {
    expect(() => buildKilterRoute({ ...climb, frames: 'p9999r13' }, holes, { heightCm: 170, armSpanCm: 172 })).toThrow('9999')
  })

  it('不认识的角色编号时报错', () => {
    expect(() => buildKilterRoute({ ...climb, frames: 'p1149r99' }, holes, { heightCm: 170, armSpanCm: 172 })).toThrow('99')
  })
})
