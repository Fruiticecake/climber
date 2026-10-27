import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadRoutes, loadTechniques } from '../src/config.js'
import { buildPreviewData, makeProjection } from '../src/preview.js'
import { renderPreviewHtml } from '../src/preview-html.js'
import mockA from '../fixtures/mock/a-sidepull-twist.json' with { type: 'json' }
import type { RunLogEntry } from '../src/runlog.js'
import type { Beta, BetaStep } from '../src/schema.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const routes = loadRoutes(path.join(root, 'routes'))
const techniques = loadTechniques(path.join(root, 'config/techniques.yaml'))
const routeD = routes.find((r) => r.id === 'd-gym-blue-tag-yellow')!
const routeA = routes.find((r) => r.id === 'a-sidepull-twist')!
const aBeta = mockA.replies[0]!.betas[0]! as Beta

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

// D 线：起点并手 #12，脚 #13/#14；右脚踩墙，左手扭转上 #11，左脚旗式
const beta: Beta = {
  label: '测试解',
  summary: '一句话',
  startPose: { LH: 12, RH: 12, LF: 13, RF: 14 },
  startFeet: { LF: 'front', RF: 'front' },
  steps: [
    step({ limb: 'RF', to: null, foot: 'smear' }),
    step({ limb: 'LH', to: 11, grip: 'side-pull', hips: 'right-in', techniques: ['twist-lock'], note: '左手侧拉 #11' }),
    step({ limb: 'LF', to: null, foot: 'flag' }),
  ],
}

const entry = (over: Partial<RunLogEntry> = {}): RunLogEntry => ({
  modelId: 'deepseek',
  passed: false,
  usd: 0.04,
  usage: { inputTokens: 1, outputTokens: 2 },
  attempts: [],
  best: {
    beta,
    violations: [{ step: 3, rule: 'R9', limbs: ['LF', 'RF'], holds: [], detail: '旗式时另一只脚必须踩在点上做支撑' }],
    warnings: [{ step: 2, rule: 'S5', detail: '提示', steps: [2, 3] }],
  },
  ...over,
})

describe('makeProjection', () => {
  it('有照片时把墙面 cm 换成照片像素', () => {
    const { toPx, width, height } = makeProjection(routeD)
    expect(toPx(373, 121)).toEqual({ x: expect.closeTo(596.8), y: expect.closeTo(956.4) })
    expect([width, height]).toEqual([810, 1440])
  })

  it('没有照片时按 1cm 一个单位，y 轴翻转', () => {
    const { toPx, width, height } = makeProjection(routeA)
    expect(toPx(100, 20)).toEqual({ x: 100, y: 400 })
    expect([width, height]).toEqual([400, 420])
  })
})

describe('buildPreviewData', () => {
  const data = buildPreviewData(routeD, entry(), techniques)
  const [start, smear, twist, flag] = data.frames

  it('起始姿态加每一步各一帧', () => {
    expect(data.frames.map((f) => f.index)).toEqual([0, 1, 2, 3])
    expect(start!.step).toBeNull()
    expect(data.subtitle).toBe('测试解 · deepseek · 未通过校验')
    expect(data.holds).toHaveLength(routeD.holds.length)
  })

  it('步骤说明翻成中文，技巧显示名字', () => {
    expect(twist!.step).toMatchObject({ limbName: '左手', target: '#11', how: '侧拉', hips: '右髋贴墙', techniques: ['扭转（侧身锁定）'] })
  })

  it('踩墙的脚画在它离开的点上', () => {
    expect(smear!.limbs.RF).toEqual({ at: start!.limbs.RF.at, hold: null, state: 'smear' })
    expect(smear!.step!.target).toBe('踩墙')
  })

  it('旗式的脚画在髋的左下方', () => {
    const lf = flag!.limbs.LF
    expect(lf.state).toBe('flag')
    expect(lf.at.x).toBeLessThan(flag!.hip.x)
    expect(lf.at.y).toBeGreaterThan(flag!.hip.y)
  })

  it('髋在肩下面，都在手脚之间', () => {
    expect(start!.hip.y).toBeGreaterThan(start!.shoulder.y)
    expect(start!.shoulder.y).toBeGreaterThan(start!.limbs.LH.at.y)
  })

  it('违规和提示挂在对应的帧上', () => {
    expect(flag!.violations).toEqual(['第 3 步（R9）：旗式时另一只脚必须踩在点上做支撑。'])
    expect(twist!.warnings).toEqual(['S5：提示'])
    expect(flag!.warnings).toEqual(['S5：提示'])
    expect(start!.violations).toEqual([])
  })

  it('没有可展示的爬法时报错', () => {
    expect(() => buildPreviewData(routeD, entry({ best: null }), techniques)).toThrow('没有可展示的爬法')
  })
})

describe('renderPreviewHtml', () => {
  it('模型写的文字里有 </script> 也不会提前结束脚本', () => {
    const evil: Beta = { ...beta, summary: '</script><script>alert(1)</script>' }
    const html = renderPreviewHtml(buildPreviewData(routeD, entry({ best: { beta: evil, violations: [], warnings: [] } }), techniques), null)
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain('\\u003c/script>')
  })

  it('标题里的 HTML 被转义；没有照片时说明按坐标画墙', () => {
    const route = { ...routeA, name: 'A <b>线</b>' }
    const data = buildPreviewData(route, entry({ best: { beta: aBeta, violations: [], warnings: [] }, passed: true }), techniques)
    const html = renderPreviewHtml(data, null)
    expect(html).toContain('<title>A &#60;b&#62;线&#60;/b&#62; · 爬法预览</title>')
    expect(html).toContain('没有照片，按线路坐标画墙面')
    expect(html).toContain('const PHOTO = null;')
    expect(html).toContain('通过校验')
  })
})
