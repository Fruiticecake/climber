import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildKilterRoute, type KilterClimb, type KilterHole } from './kilter.js'

/**
 * 从 Kilter 数据库（Hugging Face 上的 kilter_splits.sqlite）导出线路文件。
 * 列出候选：npm run kilter -- --list --angle 40
 * 导出一条：npm run kilter -- --uuid BF0DB71D0D674289BEEF46E226216BF6 --angle 40
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    db: { type: 'string', default: path.join(root, 'data/kilter_splits.sqlite') },
    uuid: { type: 'string' },
    angle: { type: 'string' },
    list: { type: 'boolean', default: false },
  },
})

/** 默认身体参数，和其他样例线路一致 */
const BODY = { heightCm: 170, armSpanCm: 172 }
const LIST_LIMIT = 15
const CLIMB_TABLES = ['kilter_train', 'kilter_val', 'kilter_test']

if (!fs.existsSync(values.db)) throw new Error(`找不到 Kilter 数据库 ${values.db}，先下载到 data/`)
const angle = Number(values.angle)
if (!Number.isFinite(angle)) throw new Error('需要 --angle，比如 --angle 40')
const db = new DatabaseSync(values.db, { readOnly: true })
const union = CLIMB_TABLES.map((t) => `select * from ${t}`).join(' union all ')
const out = (s: string) => process.stdout.write(`${s}\n`)

if (values.list) {
  const rows = db
    .prepare(
      `select uuid, name, boulder_grade, ascensionist_count, num_holds, is_nomatch from (${union})
       where angle = ? order by ascensionist_count desc limit ${LIST_LIMIT}`,
    )
    .all(angle)
  for (const r of rows) out(`${r.uuid}  ${r.boulder_grade}  ${r.ascensionist_count} 人  ${r.num_holds} 个点${r.is_nomatch ? '  不允许并手' : ''}  ${r.name}`)
} else {
  if (!values.uuid) throw new Error('需要 --uuid，或者用 --list 先列出候选')
  // 数据库里的 uuid 大小写不统一
  const row = db.prepare(`select * from (${union}) where lower(uuid) = lower(?) and angle = ?`).get(values.uuid, angle)
  if (!row) throw new Error(`数据库里没有 ${values.uuid} 在 ${angle}° 的记录`)

  const holeOfPlacement = new Map<number, KilterHole>(
    db
      .prepare('select p.id as id, h.x as x, h.y as y, h.name as name from placements p join holes h on h.id = p.hole_id where p.layout_id = 1')
      .all()
      .map((r) => [Number(r.id), { x: Number(r.x), y: Number(r.y), name: String(r.name) }]),
  )
  const links = typeof row.beta_links === 'string' ? row.beta_links.split('|').filter(Boolean) : []
  const climb: KilterClimb = {
    uuid: String(row.uuid),
    angle,
    name: String(row.name),
    grade: String(row.boulder_grade),
    ascents: Number(row.ascensionist_count),
    frames: String(row.frames),
    isNoMatch: Number(row.is_nomatch) === 1,
    betaLinks: links,
  }
  const route = buildKilterRoute(climb, holeOfPlacement, BODY)
  const file = path.join(root, 'routes', `${route.id}.json`)
  fs.writeFileSync(file, `${JSON.stringify(route, null, 2)}\n`)
  out(`${route.name}：${route.holds.length} 个点，视频 ${links.length} 个 → ${file}`)
}
db.close()
