import OpenAI from 'openai'
import type { ModelConfig } from '../config.js'
import type { ProviderReply, SolverProvider, SolverSession } from './types.js'

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

/** DeepSeek 等兼容 OpenAI Chat Completions 接口的服务 */
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
        const response = await client.chat.completions.create({
          model: config.model!,
          messages,
          response_format: { type: 'json_object' },
        })
        const choice = response.choices[0]
        const text = choice?.message.content ?? ''
        messages = [...messages, { role: 'assistant', content: text }]
        return {
          text,
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
          stopReason: choice?.finish_reason ?? null,
        }
      },
    }
  }
}
