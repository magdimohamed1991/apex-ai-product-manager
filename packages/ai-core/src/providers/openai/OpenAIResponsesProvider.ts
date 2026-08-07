import type { LLMProvider, LLMOptions, LLMResponse } from '../LLMProvider'
import type { ModelProfile } from '../ModelProfile'

/**
 * OpenAI Responses API provider.
 * Uses the Responses API (not Chat Completions) for structured output support.
 *
 * NOTE: This provider requires OPENAI_API_KEY environment variable.
 * During development, use MockLLMProvider instead.
 */
export class OpenAIResponsesProvider implements LLMProvider {
  readonly name = 'openai'
  readonly model: string

  private readonly apiKey: string
  private readonly profile: ModelProfile

  constructor(apiKey: string, profile: ModelProfile) {
    if (!apiKey) throw new Error('OpenAI API key is required')
    this.apiKey = apiKey
    this.profile = profile
    this.model = profile.model
  }

  async complete(prompt: string, options?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now()

    const body = {
      model: options?.maxTokens ? this.profile.model : this.model,
      input: prompt,
      max_output_tokens: options?.maxTokens ?? this.profile.maxTokens,
      temperature: options?.temperature ?? this.profile.temperature,
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${error}`)
    }

    const data = (await response.json()) as {
      output: Array<{ content: Array<{ text: string }> }>
      usage: { input_tokens: number; output_tokens: number; total_tokens: number }
    }

    const content = data.output?.[0]?.content?.[0]?.text ?? ''

    return {
      content,
      model: this.model,
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      durationMs: Date.now() - start,
    }
  }
}
