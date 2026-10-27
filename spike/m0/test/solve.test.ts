import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadRoutes, loadTechniques } from '../src/config.js'
import { buildRoutePrompt, buildSystemPrompt, wallStyleHint } from '../src/prompt.js'
import type { ProviderReply, SolverProvider } from '../src/providers/types.js'
import { MockProvider } from '../src/providers/mock.js'
import { extractJson, solveRoute } from '../src/solve.js'
import { verify } from '../src/verify.js'
import { renderFeedback } from '../src/violations.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const routes = loadRoutes(path.join(root, 'routes'))
const techniques = loadTechniques(path.join(root, 'config/techniques.yaml'))
const mock = new MockProvider(path.join(root, 'fixtures/mock'))
const routeById = (id: string) => routes.find((r) => r.id === id)!

type ScriptedReply = string | { text: string; stopReason: string }

/** 按剧本回复、并记录收到的消息的测试用模型；只给文本时停止原因为 end_turn */
function scripted(replies: ScriptedReply[]): { provider: SolverProvider; received: string[] } {
  const received: string[] = []
  const provider: SolverProvider = {
    id: 'scripted',
    createSession: () => ({
      async send(text: string): Promise<ProviderReply> {
        received.push(text)
        const reply = replies[received.length - 1] ?? ''
        const { text: replyText, stopReason } = typeof reply === 'string' ? { text: reply, stopReason: 'end_turn' } : reply
        return { text: replyText, usage: { inputTokens: 10, outputTokens: 20 }, stopReason }
      },
    }),
  }
  return { provider, received }
}

describe('样例数据', () => {
  it('样例线路和实拍线路都能读取', () => {
    expect(routes.map((r) => r.id)).toEqual(['a-sidepull-twist', 'b-overhang-heelhook', 'c-slab-balance', 'd-gym-blue-tag-yellow'])
  })

  it('技巧词典里有校验器依赖的 cross', () => {
    expect(techniques.map((t) => t.id)).toContain('cross')
  })

  it('提示词包含技巧词典和这条线路的身体限制', () => {
    expect(buildSystemPrompt(techniques)).toContain('twist-lock')
    expect(buildRoutePrompt(routeById('a-sidepull-twist'), 2)).toContain('双手跨度 ≤ 163cm')
    expect(buildRoutePrompt(routeById('a-sidepull-twist'), 2)).toContain('普通踩点比双手平均高度至少低 34cm')
    expect(buildRoutePrompt(routeById('a-sidepull-twist'), 2)).toContain('离双手中点水平至少 43cm，并且比双手平均高度至少低 17cm')
    // 30° 的仰角墙不受挂脚位置限制，不写这一行
    expect(buildRoutePrompt(routeById('b-overhang-heelhook'), 2)).not.toContain('离双手中点水平至少')
  })

  it('按墙角度给出不同的技巧方向', () => {
    expect(wallStyleHint(-10)).toContain('正墙')
    expect(wallStyleHint(0)).toContain('直墙')
    expect(wallStyleHint(30)).toContain('仰角')
    expect(buildRoutePrompt(routeById('c-slab-balance'), 2)).toContain('这是正墙')
  })
})

describe('extractJson', () => {
  it('容忍代码块和前后多余文字', () => {
    expect(extractJson('好的：\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('没有 JSON 时抛错', () => {
    expect(() => extractJson('没有')).toThrow()
  })
})

describe('solveRoute（mock）', () => {
  it('A：第一次就通过', async () => {
    const r = await solveRoute(routeById('a-sidepull-twist'), mock, techniques)
    expect(r.passed).toBe(true)
    expect(r.attempts).toHaveLength(1)
  })

  it('B：第一次第 5 步伸展过远，带着原因重试后通过', async () => {
    const r = await solveRoute(routeById('b-overhang-heelhook'), mock, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['violations', 'passed'])
    const firstViolations = r.attempts[0]!.candidates[0]!.result.violations
    expect(firstViolations).toEqual([expect.objectContaining({ step: 5, rule: 'R3' })])
  })

  it('C：第一次就通过，并且不会误报违规', async () => {
    const r = await solveRoute(routeById('c-slab-balance'), mock, techniques)
    expect(r.passed).toBe(true)
    expect(r.best!.result.violations).toEqual([])
  })
})

describe('solveRoute（剧本）', () => {
  const route = routeById('b-overhang-heelhook')

  it('格式错误会带着原因重试', async () => {
    const valid = JSON.stringify((await import('../fixtures/mock/b-overhang-heelhook.json')).default.replies[1])
    const { provider, received } = scripted(['不是 JSON', valid])
    const r = await solveRoute(route, provider, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['format-error', 'passed'])
    expect(received[1]).toContain('无法解析')
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 40 })
  })

  it('重试用完仍不通过时返回违规最少的候选', async () => {
    const bad = JSON.stringify((await import('../fixtures/mock/b-overhang-heelhook.json')).default.replies[0])
    const { provider, received } = scripted([bad, bad, bad])
    const r = await solveRoute(route, provider, techniques)
    expect(r.passed).toBe(false)
    expect(r.attempts).toHaveLength(3)
    expect(r.best!.result.violations.length).toBeGreaterThan(0)
    expect(received[1]).toContain('第 1～4 步合法，请保留')
  })

  it('每次尝试都记录停止原因', async () => {
    const valid = JSON.stringify((await import('../fixtures/mock/b-overhang-heelhook.json')).default.replies[1])
    const r = await solveRoute(route, scripted([valid]).provider, techniques)
    expect(r.attempts[0]!.stopReason).toBe('end_turn')
  })

  it('回复被长度上限截断时，要求少推理、直接输出 JSON，而不是重发格式错误', async () => {
    const valid = JSON.stringify((await import('../fixtures/mock/b-overhang-heelhook.json')).default.replies[1])
    const { provider, received } = scripted([{ text: '', stopReason: 'length' }, valid])
    const r = await solveRoute(route, provider, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['truncated', 'passed'])
    expect(r.attempts[0]!.stopReason).toBe('length')
    expect(received[1]).toContain('被长度上限截断')
    expect(received[1]).not.toContain('无法解析')
  })

  it('Anthropic 的 max_tokens 也算截断；截断计入重试次数', async () => {
    const cut = { text: '{"betas": [', stopReason: 'max_tokens' }
    const r = await solveRoute(route, scripted([cut, cut, cut]).provider, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['truncated', 'truncated', 'truncated'])
    expect(r.passed).toBe(false)
  })

  it('拒答时停止重试', async () => {
    const provider: SolverProvider = {
      id: 'refuse',
      createSession: () => ({ send: async () => ({ text: '', usage: { inputTokens: 1, outputTokens: 0 }, stopReason: 'refusal' }) }),
    }
    const r = await solveRoute(route, provider, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['refusal'])
  })

  it('调用出错时记录错误并停止', async () => {
    const provider: SolverProvider = {
      id: 'boom',
      createSession: () => ({ send: async () => Promise.reject(new Error('network down')) }),
    }
    const r = await solveRoute(route, provider, techniques)
    expect(r.attempts).toEqual([expect.objectContaining({ outcome: 'error', detail: 'network down' })])
  })
})

describe('solveRoute（质量重试）', () => {
  const route = routeById('c-slab-balance')
  type Reply = { betas: Array<{ steps: Array<{ hips: string }> }> }
  const loadSquare = async (): Promise<Reply> =>
    structuredClone((await import('../fixtures/mock/c-slab-balance.json')).default.replies[0]) as Reply
  /** 把第 1..n 步改成侧身，制造 S5 提示（侧身只会放宽伸展上限，硬规则仍然通过） */
  const twisted = async (n: number): Promise<string> => {
    const reply = await loadSquare()
    reply.betas[0]!.steps.slice(0, n).forEach((s) => (s.hips = 'left-in'))
    return JSON.stringify(reply)
  }
  const square = async () => JSON.stringify(await loadSquare())

  it('通过硬规则但有 S5：反馈提示再改一次，改好后采用新的', async () => {
    const { provider, received } = scripted([await twisted(3), await square()])
    const r = await solveRoute(route, provider, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['quality-retry', 'passed'])
    expect(received[1]).toContain('通过了全部硬规则，但爬法质量还有问题')
    expect(received[1]).toContain('第 1、2、3 步')
    expect(r.passed).toBe(true)
    expect(r.best!.result.warnings.map((w) => w.rule)).not.toContain('S5')
  })

  it('改后更差时保留上一次的候选', async () => {
    const { provider } = scripted([await twisted(2), await twisted(5)])
    const r = await solveRoute(route, provider, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['quality-retry', 'passed'])
    expect(r.attempts[1]!.detail).toBe('改后质量没有变好，保留上一次的候选')
    expect(r.best!.result.warnings.find((w) => w.rule === 'S5')!.steps).toEqual([1, 2])
  })

  it('改后违反硬规则时不再重试，用之前通过的候选', async () => {
    const broken = (await loadSquare()) as unknown as { betas: Array<{ steps: Array<{ to: number | null }> }> }
    broken.betas[0]!.steps[0]!.to = 99
    const { provider, received } = scripted([await twisted(2), JSON.stringify(broken)])
    const r = await solveRoute(route, provider, techniques)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['quality-retry', 'violations'])
    expect(received).toHaveLength(2)
    expect(r.passed).toBe(true)
    expect(r.best!.result.violations).toEqual([])
  })

  it('质量重试只做一次', async () => {
    const { provider, received } = scripted([await twisted(3), await twisted(2), await square()])
    const r = await solveRoute(route, provider, techniques)
    expect(received).toHaveLength(2)
    expect(r.best!.result.warnings.find((w) => w.rule === 'S5')!.steps).toEqual([1, 2])
  })

  it('maxQualityRetries 为 0 时不做质量重试', async () => {
    const { provider, received } = scripted([await twisted(3)])
    const r = await solveRoute(route, provider, techniques, { maxQualityRetries: 0 })
    expect(received).toHaveLength(1)
    expect(r.attempts.map((a) => a.outcome)).toEqual(['passed'])
  })
})

describe('renderFeedback', () => {
  it('说明违规的具体数值和可以保留的步骤', async () => {
    const bad = (await import('../fixtures/mock/b-overhang-heelhook.json')).default.replies[0]!.betas[0]!
    const route = routeById('b-overhang-heelhook')
    // fixture 是 JSON 字面量，经过 verify 前先按 schema 的形状使用
    const text = renderFeedback('技巧解', verify(route, bad as Parameters<typeof verify>[1]).violations)
    expect(text).toContain('第 5 步（R3）')
    expect(text).toContain('超过最大手脚跨度')
  })

  it('R11 说明脚离手多近、至少要多远', () => {
    const text = renderFeedback('技巧解', [{ step: 4, rule: 'R11', limbs: ['RF'], holds: [10], actualCm: 0.5, limitCm: 34 }])
    expect(text).toContain('右脚（#10）只比双手平均高度低 1cm，至少要低 34cm')
    expect(text).toContain('第 1～3 步合法')
  })
})
