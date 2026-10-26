export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
}

export interface ProviderReply {
  text: string
  usage: ProviderUsage
  /** 'refusal' 表示模型拒答；其他值仅用于记录 */
  stopReason: string | null
}

/** 一次解算对应一个会话：重试时在同一个会话里追加消息，不改写历史 */
export interface SolverSession {
  send(userText: string): Promise<ProviderReply>
}

export interface SolverProvider {
  readonly id: string
  createSession(system: string, routeId: string): SolverSession
}
