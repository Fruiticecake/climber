import OpenAI from 'openai'
import type { ModelConfig } from '../config.js'
import type { ProviderReply, SolverProvider, SolverSession } from './types.js'

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk

/** 把流式回复拼成完整回复：文本按顺序拼接，停止原因取最后出现的，用量在最后一个块里 */
export async function collectStream(chunks: AsyncIterable<ChatChunk>): Promise<ProviderReply> {
  let text = ''
  let stopReason: string | null = null
  let usage = { inputTokens: 0, outputTokens: 0 }
  for await (const chunk of chunks) {
    const choice = chunk.choices[0]
    text += choice?.delta.content ?? ''
    stopReason = choice?.finish_reason ?? stopReason
    if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens }
  }
  return { text, usage, stopReason }
}

/**
 * DeepSeek 等兼容 OpenAI Chat Completions 接口的服务。
 * 用流式请求：长推理要好几分钟，一次性等完整回复时连接容易被中途断开。
 */
export class OpenAICompatProvider implements SolverProvider {
  readonly id: string
  private readonly client: OpenAI

  constructor(private readonly config: ModelConfig) {
    if (!config.model || !config.baseUrl || !config.apiKeyEnv)
      throw new Error(`模型配置 ${config.id} 需要 model、baseUrl、apiKeyEnv`)
    const apiKey = process.env[config.apiKeyEnv]
    if (!apiKey) throw new Error(`没有设置环境变量 ${config.apiKeyEnv}`)
    this.id = config.id
    this.client = new OpenAI({ apiKey, baseURL: config.baseUrl })
  }

  createSession(system: string): SolverSession {
    const { client, config } = this
    let messages: ChatMessage[] = [{ role: 'system', content: system }]

    return {
      async send(userText: string): Promise<ProviderReply> {
        messages = [...messages, { role: 'user', content: userText }]
        const stream = await client.chat.completions.create({
          model: config.model!,
          messages,
          response_format: { type: 'json_object' },
          stream: true,
          stream_options: { include_usage: true },
        })
        const reply = await collectStream(stream)
        messages = [...messages, { role: 'assistant', content: reply.text }]
        return reply
      },
    }
  }
}
