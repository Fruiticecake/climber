import { describe, expect, it } from 'vitest'
import { deriveBody } from '../src/body.js'
import type { Beta, BetaStep } from '../src/schema.js'
import type { Route } from '../src/types.js'
import { edgeDistance, limitsFor, verify } from '../src/verify.js'

// 一条最小的直墙线路：起点 #1，左侧 #2，右上 #3（远），TOP #4
const route: Route = {
  id: 't',
  name: 't',
  description: '',
  wall: { widthCm: 400, heightCm: 400, angleDeg: 0 },
  body: { heightCm: 170, armSpanCm: 170 },
  holds: [
    { id: 1, x: 200, y: 160, r: 5, role: 'start-hand' },
    { id: 2, x: 150, y: 200, r: 5, role: 'normal' },
    { id: 3, x: 320, y: 250, r: 5, role: 'normal' },
    { id: 4, x: 200, y: 230, r: 5, role: 'top' },
    { id: 10, x: 180, y: 40, r: 5, role: 'start-foot' },
    { id: 11, x: 230, y: 40, r: 5, role: 'start-foot' },
    { id: 12, x: 200, y: 300, r: 5, role: 'normal' },
  ],
}

const step = (over: Partial<BetaStep> & Pick<BetaStep, 'limb' | 'to'>): BetaStep => ({
  grip: null,
  foot: null,
  hips: 'square',
  hipsToWall: 'close',
  motion: 'static',
  techniques: [],
  note: '',
  why: '',
  commonMistake: null,
  ...over,
})

const beta = (steps: BetaStep[], startPose: Beta['startPose'] = { LH: 1, RH: 1, LF: 10, RF: 11 }): Beta => ({
  label: 'x',
  summary: '',
  startPose,
  startFeet: { LF: 'front', RF: 'front' },
  steps,
})

const toTop = [step({ limb: 'LH', to: 4 }), step({ limb: 'RH', to: 4 })]
const rules = (b: Beta) => verify(route, b).violations.map((v) => v.rule)

describe('身体尺寸', () => {
  it('按比例推导肩宽、臂长、肩高', () => {
    const d = deriveBody({ heightCm: 170, armSpanCm: 170 })
    expect(d.shoulderWidthCm).toBeCloseTo(39.1)
    expect(d.armLengthCm).toBeCloseTo(65.45)
    expect(d.shoulderHeightCm).toBeCloseTo(139.4)
  })
})

describe('edgeDistance', () => {
  it('减去两个岩点的半径，同一个点距离为 0', () => {
    const [a, b] = [route.holds[0]!, route.holds[1]!]
    expect(edgeDistance(a, b)).toBeCloseTo(Math.hypot(50, 40) - 10)
    expect(edgeDistance(a, a)).toBe(0)
  })
})

describe('verify', () => {
  it('合法的爬法没有违规', () => {
    expect(verify(route, beta(toTop)).violations).toEqual([])
  })

  it('R1：起始双手不在起点上', () => {
    expect(rules(beta(toTop, { LH: 2, RH: 1, LF: 10, RF: 11 }))).toContain('R1')
  })

  it('R1：结束时没有双手在 TOP 上', () => {
    expect(rules(beta([step({ limb: 'LH', to: 4 })]))).toContain('R1')
  })

  it('R1：引用不存在的点位时直接返回，不做几何检查', () => {
    const v = verify(route, beta([step({ limb: 'LH', to: 99 })])).violations
    expect(v).toHaveLength(1)
    expect(v[0]!.rule).toBe('R1')
  })

  it('R2：双手跨度超限', () => {
    // #2 和 #3 边缘距离约 166cm，超过 170 × 0.95 = 161.5cm
    const b = beta([step({ limb: 'LH', to: 2 }), step({ limb: 'RH', to: 3 }), step({ limb: 'RH', to: 4 }), step({ limb: 'LH', to: 4 })])
    expect(rules(b)).toContain('R2')
  })

  it('扭转：髋贴墙时对侧手的跨度放宽，不再违规', () => {
    const b = beta([
      step({ limb: 'LH', to: 2 }),
      step({ limb: 'RH', to: 3, hips: 'left-in', techniques: ['twist-lock'] }),
      step({ limb: 'RH', to: 4 }),
      step({ limb: 'LH', to: 4 }),
    ])
    expect(rules(b)).not.toContain('R2')
  })

  describe('手脚跨度和技巧放宽', () => {
    // #30 到左脚 #10 的边缘距离约 205cm：超过静态上限约 195cm，但在 1.1 倍放宽后的约 214cm 之内
    const reach: Route = { ...route, holds: [...route.holds, { id: 30, x: 260, y: 240, r: 5, role: 'normal' }] }
    const r3With30 = (b: Beta) =>
      verify(reach, b).violations.filter((v) => v.rule === 'R3' && v.holds.includes(30) && v.holds.includes(10))

    it('前提：这个距离介于静态上限和放宽上限之间', () => {
      const d = edgeDistance(reach.holds.find((h) => h.id === 30)!, reach.holds.find((h) => h.id === 10)!)
      const limit = limitsFor(reach.body).handFootCm
      expect(d).toBeGreaterThan(limit)
      expect(d).toBeLessThan(limit * 1.1)
    })

    it('R3：静态伸过去会违规', () => {
      expect(r3With30(beta([step({ limb: 'RH', to: 30 })]))).toHaveLength(1)
    })

    it('左髋贴墙放宽的是右手', () => {
      expect(r3With30(beta([step({ limb: 'RH', to: 30, hips: 'left-in' })]))).toEqual([])
    })

    it('右髋贴墙放宽的是左手，对右手不生效', () => {
      expect(r3With30(beta([step({ limb: 'RH', to: 30, hips: 'right-in' })]))).toHaveLength(1)
    })

    it('定点够到之后，这两个点不变时后续步骤不重复报错', () => {
      const b = beta([step({ limb: 'RH', to: 30, motion: 'deadpoint' }), step({ limb: 'LH', to: 2 })])
      expect(r3With30(b)).toEqual([])
    })
  })

  it('R5：手不能悬空', () => {
    expect(rules(beta([step({ limb: 'LH', to: null }), ...toTop]))).toContain('R5')
  })

  it('R5：脚离开点位要标 smear 或 flag', () => {
    expect(rules(beta([step({ limb: 'LF', to: null, foot: 'front' }), ...toTop]))).toContain('R5')
    expect(rules(beta([step({ limb: 'LF', to: null, foot: 'smear' }), ...toTop]))).not.toContain('R5')
  })

  it('R6：脚高过手，除非挂脚', () => {
    const high = beta([step({ limb: 'LF', to: 12, foot: 'front' }), ...toTop])
    expect(rules(high)).toContain('R6')
    const hooked = beta([step({ limb: 'LF', to: 12, foot: 'heel-hook' }), ...toTop])
    expect(rules(hooked)).not.toContain('R6')
  })

  it('R7：交叉手需要标 cross', () => {
    const crossed = beta([step({ limb: 'RH', to: 2 }), step({ limb: 'LH', to: 4 }), step({ limb: 'RH', to: 4 })])
    expect(rules(crossed)).toContain('R7')
    const marked = beta([step({ limb: 'RH', to: 2, techniques: ['cross'] }), step({ limb: 'RH', to: 4 }), step({ limb: 'LH', to: 4 })])
    expect(rules(marked)).not.toContain('R7')
  })

  it('R7：标了 cross 之后只移动脚，交叉状态继续允许', () => {
    const b = beta([step({ limb: 'RH', to: 2, techniques: ['cross'] }), step({ limb: 'LF', to: null, foot: 'smear' }), step({ limb: 'RH', to: 4 }), step({ limb: 'LH', to: 4 })])
    expect(rules(b)).not.toContain('R7')
  })

  it('R8：原地不动或回到旧姿态', () => {
    expect(rules(beta([step({ limb: 'LF', to: 10 }), ...toTop]))).toContain('R8')
    const back = beta([step({ limb: 'LH', to: 2 }), step({ limb: 'LH', to: 1 }), ...toTop])
    expect(rules(back)).toContain('R8')
  })

  it('R10：脚不能踩在手正抓着的点上，翻上时除外', () => {
    const low: Route = { ...route, holds: [...route.holds, { id: 40, x: 210, y: 120, r: 5, role: 'normal' }] }
    const shared = verify(low, beta([step({ limb: 'RH', to: 40 }), step({ limb: 'LF', to: 40 }), ...toTop])).violations
    expect(shared.map((v) => v.rule)).toContain('R10')
    const rockOver = verify(low, beta([step({ limb: 'RH', to: 40 }), step({ limb: 'LF', to: 40, techniques: ['rock-over'] }), ...toTop])).violations
    expect(rockOver.map((v) => v.rule)).not.toContain('R10')
  })

  it('R9：旗式时另一只脚必须在点上', () => {
    const b = beta([step({ limb: 'RF', to: null, foot: 'smear' }), step({ limb: 'LF', to: null, foot: 'flag' }), ...toTop])
    expect(rules(b)).toContain('R9')
  })

  it('S1：无脚移动手只给提示', () => {
    const b = beta([step({ limb: 'LF', to: null, foot: 'smear' }), step({ limb: 'RF', to: null, foot: 'smear' }), ...toTop])
    const result = verify(route, b)
    expect(result.warnings.map((w) => w.rule)).toContain('S1')
  })
})
