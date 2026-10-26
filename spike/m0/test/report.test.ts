import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadModels, loadRoutes, loadTechniques } from '../src/config.js'
import { createProvider, estimateUsd } from '../src/providers/index.js'
import { buildReport } from '../src/report.js'
import { solveRoute } from '../src/solve.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const models = loadModels(path.join(root, 'config/models.yaml'))
const routes = loadRoutes(path.join(root, 'routes'))
const techniques = loadTechniques(path.join(root, 'config/techniques.yaml'))
const modelById = (id: string) => models.find((m) => m.id === id)!

describe('estimateUsd', () => {
  it('按每百万 token 的单价计算', () => {
    expect(estimateUsd(modelById('claude-opus-5-5'), 3000, 3000)).toBeCloseTo(0.072)
  })

  it('mock 为 0，未填价格的第三方为 null', () => {
    expect(estimateUsd(modelById('mock'), 100, 100)).toBe(0)
    expect(estimateUsd(modelById('deepseek'), 100, 100)).toBeNull()
  })
})

describe('buildReport', () => {
  it('包含汇总表、步骤表和重试记录', async () => {
    const provider = createProvider(modelById('mock'), path.join(root, 'fixtures/mock'))
    const route = routes.find((r) => r.id === 'b-overhang-heelhook')!
    const result = await solveRoute(route, provider, techniques)
    const report = buildReport([{ route, entries: [{ modelId: 'mock', result, usd: 0 }] }], new Date('2026-10-26T10:00:00Z'))

    expect(report).toContain('## B 30° 仰角挂脚跟')
    expect(report).toContain('| mock | ✅ | 2 | 0 |')
    expect(report).toContain('第 1 次：violations；第 2 次：passed')
    expect(report).toContain('| 5 | 右手 | #8 | pull |')
    expect(report).toContain('定点，需要发力并精准抓点')
  })
})
