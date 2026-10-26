import type { ModelConfig } from '../config.js'
import { AnthropicProvider } from './anthropic.js'
import { MockProvider } from './mock.js'
import { OpenAICompatProvider } from './openai-compat.js'
import type { SolverProvider } from './types.js'

export function createProvider(config: ModelConfig, mockFixtureDir: string): SolverProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config)
    case 'openai-compat':
      return new OpenAICompatProvider(config)
    case 'mock':
      return new MockProvider(mockFixtureDir)
  }
}

export function estimateUsd(config: ModelConfig, inputTokens: number, outputTokens: number): number | null {
  if (!config.price) return config.provider === 'mock' ? 0 : null
  return (inputTokens * config.price.input + outputTokens * config.price.output) / 1_000_000
}
