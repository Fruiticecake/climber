import { describe, expect, it } from 'vitest'
import { deriveBody } from '../src/body.js'
import type { Beta, BetaStep } from '../src/schema.js'
import type { Route } from '../src/types.js'
import { simulate } from '../src/simulate.js'
import { edgeDistance, limitsFor, verify } from '../src/verify.js'
import { renderViolation } from '../src/violations.js'

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
    // #12 比起点手 #1 高 140cm，挂脚也不行
    const hooked = beta([step({ limb: 'LF', to: 12, foot: 'heel-hook' }), ...toTop])
    expect(verify(route, hooked).violations).toContainEqual(expect.objectContaining({ rule: 'R6', step: 1, detail: 'hook' }))
  })

  it('R6：挂脚高过手但在上限之内是允许的', () => {
    // #50 比起点手 #1 高 30cm，没超过挂脚上限 40cm
    const hookRoute: Route = { ...route, holds: [...route.holds, { id: 50, x: 260, y: 190, r: 5, role: 'normal' }] }
    const b = beta([step({ limb: 'RF', to: 50, foot: 'heel-hook' }), step({ limb: 'RF', to: 11, foot: 'front' }), ...toTop])
    expect(verify(hookRoute, b).violations.filter((v) => v.rule === 'R6')).toEqual([])
    const plain = beta([step({ limb: 'RF', to: 50, foot: 'front' }), step({ limb: 'RF', to: 11, foot: 'front' }), ...toTop])
    expect(verify(hookRoute, plain).violations.map((v) => v.rule)).toContain('R6')
  })

  describe('R11：身体不能压得太紧', () => {
    // 起点手 #1 在 y=160；#60 只低 20cm，#61 低 40cm；170cm 的人最少要低 34cm
    const tight: Route = {
      ...route,
      holds: [...route.holds, { id: 60, x: 190, y: 140, r: 5, role: 'normal' }, { id: 61, x: 190, y: 120, r: 5, role: 'normal' }],
    }
    const tightRules = (steps: BetaStep[]) => verify(tight, beta([...steps, ...toTop])).violations.map((v) => v.rule)

    it('普通踩点离双手太近时违规，并给出实际距离和下限', () => {
      const v = verify(tight, beta([step({ limb: 'LF', to: 60, foot: 'front' }), ...toTop])).violations
      expect(v).toContainEqual(expect.objectContaining({ rule: 'R11', step: 1, limbs: ['LF'], holds: [60], actualCm: 20, limitCm: 34 }))
    })

    it('离双手足够远时不违规', () => {
      expect(tightRules([step({ limb: 'LF', to: 61, foot: 'front' })])).not.toContain('R11')
    })

    it('挂脚跟、勾脚尖不受限制', () => {
      expect(tightRules([step({ limb: 'LF', to: 60, foot: 'heel-hook' })])).not.toContain('R11')
    })

    it('rock-over 那一步允许，之后这只脚不动时继续允许', () => {
      const steps = [step({ limb: 'LF', to: 60, foot: 'front', techniques: ['rock-over'] }), step({ limb: 'RF', to: null, foot: 'smear' })]
      expect(tightRules(steps)).not.toContain('R11')
    })

    it('先上高脚、下一步 rock-over 翻上去，上脚那一步也允许', () => {
      const steps = [step({ limb: 'LF', to: 60, foot: 'front' }), step({ limb: 'LH', to: 4, techniques: ['rock-over'] }), step({ limb: 'RH', to: 4 })]
      expect(verify(tight, beta(steps)).violations.map((v) => v.rule)).not.toContain('R11')
    })

    it('只标 high-step 不算豁免', () => {
      expect(tightRules([step({ limb: 'LF', to: 60, foot: 'front', techniques: ['high-step'] })])).toContain('R11')
    })

    it('脚已经高过手时只报 R6，不重复报 R11', () => {
      const high = verify(route, beta([step({ limb: 'LF', to: 12, foot: 'front' }), ...toTop])).violations.map((v) => v.rule)
      expect(high).toContain('R6')
      expect(high).not.toContain('R11')
    })
  })

  it('R13：只能踩脚的点，手不能抓；脚可以踩', () => {
    const footOnly: Route = { ...route, holds: [...route.holds, { id: 90, x: 210, y: 120, r: 5, role: 'foot-only' }] }
    const hand = verify(footOnly, beta([step({ limb: 'RH', to: 90 }), ...toTop])).violations
    expect(hand).toContainEqual(expect.objectContaining({ rule: 'R13', step: 1, limbs: ['RH'], holds: [90] }))
    expect(renderViolation(hand.find((v) => v.rule === 'R13')!)).toBe('第 1 步（R13）：#90 是只能踩脚的点，手不能抓。')
    const foot = verify(footOnly, beta([step({ limb: 'RF', to: 90, foot: 'front' }), ...toTop])).violations
    expect(foot.map((v) => v.rule)).not.toContain('R13')
  })

  describe('R12：不陡的墙上，挂脚要挂在侧面', () => {
    // 起点手 #1 在 (200,160)；170cm 的人：侧向至少 42.5cm，比手低至少 17cm
    const hooks: Route = {
      ...route,
      holds: [
        ...route.holds,
        { id: 60, x: 190, y: 140, r: 5, role: 'normal' },
        { id: 80, x: 120, y: 130, r: 5, role: 'normal' },
        { id: 81, x: 120, y: 175, r: 5, role: 'normal' },
      ],
    }
    const hookRules = (r: Route, to: number) =>
      verify(r, beta([step({ limb: 'LF', to, foot: 'heel-hook' }), step({ limb: 'LF', to: 10, foot: 'front' }), ...toTop])).violations

    it('挂在手旁边：违规，说明需要的侧向距离和高度', () => {
      const v = hookRules(hooks, 60).filter((x) => x.rule === 'R12')
      expect(v).toEqual([expect.objectContaining({ step: 1, limbs: ['LF'], holds: [60] })])
      expect(renderViolation(v[0]!)).toBe(
        '第 1 步（R12）：左脚（#60）挂脚：墙只有 0°，不算陡，挂脚要挂在身体侧面——离双手中点水平至少 43cm（现在 10cm），并且比双手平均高度至少低 17cm（现在 20cm）；否则改成普通踩点，或者先把手移开、移高再挂。',
      )
    })

    it('挂在侧面、比手低：允许', () => {
      expect(hookRules(hooks, 80).map((x) => x.rule)).not.toContain('R12')
    })

    it('挂在侧面但比手高：违规', () => {
      expect(hookRules(hooks, 81).map((x) => x.rule)).toContain('R12')
    })

    it('勾脚尖同样要求', () => {
      const v = verify(hooks, beta([step({ limb: 'LF', to: 60, foot: 'toe-hook' }), step({ limb: 'LF', to: 10, foot: 'front' }), ...toTop])).violations
      expect(v.map((x) => x.rule)).toContain('R12')
    })

    it('陡墙（≥15°）上挂在手旁边也允许', () => {
      const steep: Route = { ...hooks, wall: { ...hooks.wall, angleDeg: 15 } }
      expect(hookRules(steep, 60).map((x) => x.rule)).not.toContain('R12')
    })

    it('挂脚之后手移动，挂脚不再在侧面时也报', () => {
      // 挂好 #80（120,130）后左手移到 #2（150,200）：双手中点 x=175，侧向 55cm，仍合格
      const ok = verify(hooks, beta([step({ limb: 'LF', to: 80, foot: 'heel-hook' }), step({ limb: 'LH', to: 2 }), step({ limb: 'LF', to: 10, foot: 'front' }), ...toTop])).violations
      expect(ok.map((x) => x.rule)).not.toContain('R12')
      // 左手改移到挂脚正上方的 #82（115,200）：双手中点 x=157.5，侧向只剩 37.5cm，这一步报违规
      const above: Route = { ...hooks, holds: [...hooks.holds, { id: 82, x: 115, y: 200, r: 5, role: 'normal' }] }
      const bad = verify(above, beta([step({ limb: 'LF', to: 80, foot: 'heel-hook' }), step({ limb: 'LH', to: 82 }), step({ limb: 'LF', to: 10, foot: 'front' }), ...toTop])).violations
      expect(bad).toContainEqual(expect.objectContaining({ rule: 'R12', step: 2, holds: [80] }))
    })
  })

  describe('踩墙的脚按它离开的点算位置', () => {
    // #70 离右脚起点 #11 有 171cm，超过双脚跨度上限 153cm；离起点手 #1 170cm，没超手脚跨度
    const wide: Route = { ...route, holds: [...route.holds, { id: 70, x: 50, y: 60, r: 5, role: 'normal' }] }

    it('simulate 记下踩墙的脚离开的点，换回踩点或旗式时清掉', () => {
      const frames = simulate(
        beta([
          step({ limb: 'RF', to: null, foot: 'smear' }),
          step({ limb: 'LH', to: 2 }),
          step({ limb: 'RF', to: 11, foot: 'front' }),
          step({ limb: 'RF', to: null, foot: 'flag' }),
        ]),
      )
      expect(frames.map((f) => f.smearAt.RF)).toEqual([null, 11, 11, null, null])
    })

    it('R4：一只脚踩墙，另一只脚也不能跨出双脚跨度', () => {
      const v = verify(wide, beta([step({ limb: 'RF', to: null, foot: 'smear' }), step({ limb: 'LF', to: 70, foot: 'front' }), ...toTop])).violations
      expect(v).toContainEqual(expect.objectContaining({ rule: 'R4', step: 2, limbs: ['LF', 'RF'], holds: [70, 11], detail: 'smear' }))
    })

    it('R3：踩墙的脚和手的距离也要检查', () => {
      const v = verify(route, beta([step({ limb: 'RF', to: null, foot: 'smear' }), step({ limb: 'LH', to: 12 }), ...toTop])).violations
      expect(v).toContainEqual(expect.objectContaining({ rule: 'R3', step: 2, limbs: ['LH', 'RF'], holds: [12, 11], detail: 'smear' }))
    })

    it('反馈里说明这只脚在踩墙、按哪个点算', () => {
      const text = renderViolation({ step: 2, rule: 'R4', limbs: ['LF', 'RF'], holds: [70, 11], actualCm: 171, limitCm: 153, detail: 'smear' })
      expect(text).toContain('踩墙的脚按它离开的点算位置')
    })
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

  describe('R7：标了 cross 也有交叉幅度上限', () => {
    // 170cm 的人：双手最多交叉 51cm，双脚最多交叉 34cm。左手 #1 在 x=200，左右脚 #10、#11 在 x=180、230
    const crossing: Route = {
      ...route,
      holds: [
        ...route.holds,
        { id: 95, x: 130, y: 170, r: 5, role: 'normal' },
        { id: 96, x: 270, y: 45, r: 5, role: 'normal' },
        { id: 97, x: 255, y: 45, r: 5, role: 'normal' },
      ],
    }
    const crossRules = (steps: BetaStep[]) => verify(crossing, beta([...steps, ...toTop])).violations

    it('双手交叉 50cm 在上限内，标了 cross 就允许（同上面的测试）', () => {
      expect(rules(beta([step({ limb: 'RH', to: 2, techniques: ['cross'] }), step({ limb: 'RH', to: 4 }), step({ limb: 'LH', to: 4 })]))).not.toContain('R7')
    })

    it('双手交叉 70cm 超过上限，标了 cross 也违规，并说明幅度', () => {
      // 第 2 步左手换到 #4 时右手还在 #95，仍然交叉 70cm，也会再报一次；这里只看第 1 步
      const v = crossRules([step({ limb: 'RH', to: 95, techniques: ['cross'] })]).filter((x) => x.rule === 'R7' && x.step === 1)
      expect(v).toEqual([expect.objectContaining({ limbs: ['LH', 'RH'], holds: [1, 95], actualCm: 70, detail: 'too-far' })])
      expect(v[0]!.limitCm).toBeCloseTo(51)
      expect(renderViolation(v[0]!)).toBe('第 1 步（R7）：左手（#1）和右手（#95）左右交叉了 70cm，超过交叉上限 51cm，标了 cross 也做不到。')
    })

    it('双脚交叉 40cm 超过上限 34cm', () => {
      const v = crossRules([step({ limb: 'LF', to: 96, foot: 'front', techniques: ['cross'] })]).filter((x) => x.rule === 'R7')
      expect(v).toEqual([expect.objectContaining({ step: 1, limbs: ['LF', 'RF'], holds: [96, 11], actualCm: 40, detail: 'too-far' })])
    })

    it('双脚交叉 25cm：标了 cross 允许，没标违规', () => {
      expect(crossRules([step({ limb: 'LF', to: 97, foot: 'front', techniques: ['cross'] })]).map((x) => x.rule)).not.toContain('R7')
      expect(crossRules([step({ limb: 'LF', to: 97, foot: 'front' })]).map((x) => x.rule)).toContain('R7')
    })
  })

  it('S6：标了 cross 但手脚都没有交叉，整套爬法给一条提示', () => {
    const notCrossed: Route = { ...route, holds: [...route.holds, { id: 98, x: 240, y: 190, r: 5, role: 'normal' }] }
    const b = beta([step({ limb: 'RH', to: 98, techniques: ['cross'] }), step({ limb: 'LH', to: 4 }), step({ limb: 'RH', to: 4, techniques: ['cross'] })])
    const result = verify(notCrossed, b)
    expect(result.violations).toEqual([])
    expect(result.warnings.filter((w) => w.rule === 'S6')).toEqual([
      { step: 1, steps: [1, 3], rule: 'S6', detail: '第 1、3 步标了 cross，但这一步手和脚都没有交叉；cross 只在确实交叉时写' },
    ])
    // 真的交叉时不提示
    const real = verify(route, beta([step({ limb: 'RH', to: 2, techniques: ['cross'] }), step({ limb: 'RH', to: 4 }), step({ limb: 'LH', to: 4 })]))
    expect(real.warnings.map((w) => w.rule)).not.toContain('S6')
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

  describe('S5：正墙上的侧身技巧', () => {
    const slab: Route = { ...route, wall: { ...route.wall, angleDeg: -10 } }
    const twisty = beta([step({ limb: 'LH', to: 2, hips: 'left-in' }), step({ limb: 'RF', to: null, foot: 'smear', techniques: ['backstep'] }), ...toTop])

    it('正墙上用了侧身或扭转，整套爬法给一条提示并列出步骤', () => {
      const s5 = verify(slab, twisty).warnings.filter((w) => w.rule === 'S5')
      expect(s5).toHaveLength(1)
      expect(s5[0]!.detail).toContain('第 1、2 步')
    })

    it('正墙上正身爬没有提示', () => {
      expect(verify(slab, beta(toTop)).warnings.map((w) => w.rule)).not.toContain('S5')
    })

    it('直墙上侧身不提示', () => {
      expect(verify(route, twisty).warnings.map((w) => w.rule)).not.toContain('S5')
    })

    it('S5 只是提示，不算违规', () => {
      expect(verify(slab, twisty).violations.map((v) => v.rule)).not.toContain('S5')
    })
  })

  it('S1：无脚移动手只给提示', () => {
    const b = beta([step({ limb: 'LF', to: null, foot: 'smear' }), step({ limb: 'RF', to: null, foot: 'smear' }), ...toTop])
    const result = verify(route, b)
    expect(result.warnings.map((w) => w.rule)).toContain('S1')
  })
})
