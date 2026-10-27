import type OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { collectStream } from '../src/providers/openai-compat.js'

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

const chunk = (content: string | null, finishReason: string | null = null): Chunk =>
  ({ choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] }) as unknown as Chunk

async function* stream(chunks: Chunk[]): AsyncGenerator<Chunk> {
  yield* chunks
}

describe('collectStream', () => {
  it('拼接文本，取最后的停止原因和用量', async () => {
    const usageChunk = { choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } } as unknown as Chunk
    const reply = await collectStream(stream([chunk('{"be'), chunk(null), chunk('tas":[]}', 'stop'), usageChunk]))
    expect(reply).toEqual({ text: '{"betas":[]}', usage: { inputTokens: 12, outputTokens: 34 }, stopReason: 'stop' })
  })

  it('被长度上限截断时停止原因是 length；没有用量块时记 0', async () => {
    const reply = await collectStream(stream([chunk('{"betas": [', 'length')]))
    expect(reply).toEqual({ text: '{"betas": [', usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'length' })
  })
})
