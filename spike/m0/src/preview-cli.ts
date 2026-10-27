import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadRoutes, loadTechniques } from './config.js'
import { buildPreviewData } from './preview.js'
import { renderPreviewHtml } from './preview-html.js'
import { parseRunLog } from './runlog.js'

/**
 * 从一次运行的 JSON 结果生成动画预览页。
 * 用法：npm run preview -- [--log reports/m0-xxx.json] [--route 线路id] [--model 模型id]
 * 不指定 --log 时用 reports/ 里最新的一次。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportDir = path.join(root, 'reports')
const { values } = parseArgs({ options: { log: { type: 'string' }, route: { type: 'string' }, model: { type: 'string' } } })

function latestLog(): string {
  const logs = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter((f) => /^m0-.*\.json$/.test(f)).sort() : []
  const last = logs[logs.length - 1]
  if (!last) throw new Error('reports/ 里还没有运行结果 JSON，先跑一次 npm run m0')
  return path.join(reportDir, last)
}

const logFile = values.log ? path.resolve(values.log) : latestLog()
const log = parseRunLog(fs.readFileSync(logFile, 'utf8'))
const run = values.route ? log.runs.find((r) => r.routeId === values.route) : log.runs[0]
if (!run) throw new Error(`${logFile} 里没有线路 ${values.route}`)
const entry = values.model ? run.entries.find((e) => e.modelId === values.model) : run.entries[0]
if (!entry) throw new Error(`${logFile} 里线路 ${run.routeId} 没有模型 ${values.model}`)

const route = loadRoutes(path.join(root, 'routes')).find((r) => r.id === run.routeId)
if (!route) throw new Error(`routes/ 里没有线路 ${run.routeId}`)
const techniques = loadTechniques(path.join(root, 'config/techniques.yaml'))

const photoFile = route.photo && path.join(root, route.photo.file)
const photo = photoFile && fs.existsSync(photoFile) ? `data:image/jpeg;base64,${fs.readFileSync(photoFile).toString('base64')}` : null
// 照片缺失时退回到按坐标画墙：坐标系要跟着换掉
const data = buildPreviewData(photo ? route : { ...route, photo: undefined }, entry, techniques)

fs.mkdirSync(reportDir, { recursive: true })
const outFile = path.join(reportDir, `preview-${route.id}-${entry.modelId}.html`)
fs.writeFileSync(outFile, renderPreviewHtml(data, photo))
const photoNote = photo ? '' : route.photo ? `（没有找到照片 ${route.photo.file}，按坐标画墙面）` : '（线路没有照片，按坐标画墙面）'
process.stdout.write(`数据：${logFile}\n预览：${outFile}${photoNote}\n`)
