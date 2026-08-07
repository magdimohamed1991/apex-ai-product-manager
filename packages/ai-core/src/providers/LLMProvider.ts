/**
 * Core LLM provider abstraction.
 * Agents never import OpenAI/Anthropic/Gemini directly.
 * They call LLMProvider — the implementation is injected.
 */
export interface LLMProvider {
  readonly name: string
  readonly model: string

  complete(prompt: string, options?: LLMOptions): Promise<LLMResponse>
}

export interface LLMOptions {
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
}

export interface LLMResponse {
  content: string
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  durationMs: number
}
