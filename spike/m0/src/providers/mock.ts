import fs from 'node:fs'
import path from 'node:path'
import type { ProviderReply, SolverProvider, SolverSession } from './types.js'

/**
 * 零成本的模拟模型：按剧本依次返回 fixtures/mock/<线路 id>.json 里的 replies。
 * 剧本用完后重复最后一条。
 */
export class MockProvider implements SolverProvider {
  readonly id = 'mock'

  constructor(private readonly fixtureDir: string) {}

  createSession(_system: string, routeId: string): SolverSession {
    const file = path.join(this.fixtureDir, `${routeId}.json`)
    const replies: unknown[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).replies : []
    let turn = 0

    return {
      async send(): Promise<ProviderReply> {
        const reply = replies[Math.min(turn, replies.length - 1)]
        turn += 1
        return {
          text: reply === undefined ? '' : typeof reply === 'string' ? reply : JSON.stringify(reply),
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: 'end_turn',
        }
      },
    }
  }
}
