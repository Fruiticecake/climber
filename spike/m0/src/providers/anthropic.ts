import Anthropic from '@anthropic-ai/sdk'
import type { ModelConfig } from '../config.js'
import type { ProviderReply, SolverProvider, SolverSession } from './types.js'

const MAX_TOKENS = 32000

export class AnthropicProvider implements SolverProvider {
  readonly id: string
  private readonly client = new Anthropic()

  constructor(private readonly config: ModelConfig) {
    if (!config.model) throw new Error(`模型配置 ${config.id} 缺少 model 字段`)
    this.id = config.id
  }

  createSession(system: string): SolverSession {
    const { client, config } = this
    let messages: Anthropic.Beta.BetaMessageParam[] = []

    return {
      async send(userText: string): Promise<ProviderReply> {
        messages = [...messages, { role: 'user', content: userText }]
        const stream = client.beta.messages.stream({
          model: config.model!,
          max_tokens: MAX_TOKENS,
          // 系统提示词不随线路变化，缓存后重试和换线路都更便宜
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
          ...(config.effort ? { output_config: { effort: config.effort } } : {}),
          // 拒答时由服务端按类别自动换模型
          ...(config.serverFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        } as Anthropic.Beta.MessageCreateParamsStreaming)
        const response = await stream.finalMessage()
        // 整块原样追加（包括思考块），重试时模型能看到自己上一次的思路
        messages = [...messages, { role: 'assistant', content: response.content }]
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        return {
          text,
          usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
          stopReason: response.stop_reason,
        }
      },
    }
  }
}
