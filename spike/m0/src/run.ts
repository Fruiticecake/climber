import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadModels, loadRoutes, loadTechniques } from './config.js'
import { createProvider, estimateUsd } from './providers/index.js'
import { buildReport, type RunEntry } from './report.js'
import { solveRoute } from './solve.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

const { values } = parseArgs({
  options: {
    models: { type: 'string', default: 'mock' },
    routes: { type: 'string' },
    candidates: { type: 'string', default: '2' },
  },
})

const allModels = loadModels(path.join(root, 'config/models.yaml'))
const techniques = loadTechniques(path.join(root, 'config/techniques.yaml'))
const routeFilter = values.routes?.split(',')
const routes = loadRoutes(path.join(root, 'routes')).filter((r) => !routeFilter || routeFilter.includes(r.id))
const modelIds = values.models.split(',')
const models = modelIds.map((id) => {
  const m = allModels.find((c) => c.id === id)
  if (!m) throw new Error(`config/models.yaml 里没有模型 ${id}`)
  return m
})

const log = (s: string) => process.stdout.write(`${s}\n`)
const startedAt = new Date()
const runs: Array<{ route: (typeof routes)[number]; entries: RunEntry[] }> = []

for (const route of routes) {
  const entries: RunEntry[] = []
  for (const model of models) {
    log(`▶ ${route.id} × ${model.id} ...`)
    const provider = createProvider(model, path.join(root, 'fixtures/mock'))
    const result = await solveRoute(route, provider, techniques, { candidates: Number(values.candidates) })
    const usd = estimateUsd(model, result.usage.inputTokens, result.usage.outputTokens)
    log(`  ${result.passed ? '通过' : '未通过'}，尝试 ${result.attempts.length} 次，费用 ${usd === null ? '未知' : `$${usd.toFixed(4)}`}`)
    entries.push({ modelId: model.id, result, usd })
  }
  runs.push({ route, entries })
}

const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)
const reportDir = path.join(root, 'reports')
fs.mkdirSync(reportDir, { recursive: true })
const reportFile = path.join(reportDir, `m0-${stamp}.md`)
fs.writeFileSync(reportFile, buildReport(runs, startedAt))
log(`报告：${reportFile}`)
