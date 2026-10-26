import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadRoutes, loadTechniques } from '../src/config.js'
import { buildRoutePrompt, buildSystemPrompt } from '../src/prompt.js'
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

/** 按剧本回复、并记录收到的消息的测试用模型 */
function scripted(replies: string[]): { provider: SolverProvider; received: string[] } {
  const received: string[] = []
  const provider: SolverProvider = {
    id: 'scripted',
    createSession: () => ({
      async send(text: string): Promise<ProviderReply> {
        received.push(text)
        return { text: replies[received.length - 1] ?? '', usage: { inputTokens: 10, outputTokens: 20 }, stopReason: 'end_turn' }
      },
    }),
  }
  return { provider, received }
}

describe('样例数据', () => {
  it('三条样例线路都能读取', () => {
    expect(routes.map((r) => r.id)).toEqual(['a-sidepull-twist', 'b-overhang-heelhook', 'c-slab-balance'])
  })

  it('技巧词典里有校验器依赖的 cross', () => {
    expect(techniques.map((t) => t.id)).toContain('cross')
  })

  it('提示词包含技巧词典和这条线路的身体限制', () => {
    expect(buildSystemPrompt(techniques)).toContain('twist-lock')
    expect(buildRoutePrompt(routeById('a-sidepull-twist'), 2)).toContain('双手跨度 ≤ 163cm')
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

describe('renderFeedback', () => {
  it('说明违规的具体数值和可以保留的步骤', async () => {
    const bad = (await import('../fixtures/mock/b-overhang-heelhook.json')).default.replies[0]!.betas[0]!
    const route = routeById('b-overhang-heelhook')
    // fixture 是 JSON 字面量，经过 verify 前先按 schema 的形状使用
    const text = renderFeedback('技巧解', verify(route, bad as Parameters<typeof verify>[1]).violations)
    expect(text).toContain('第 5 步（R3）')
    expect(text).toContain('超过最大手脚跨度')
  })
})
