import type { LLMProvider, LLMOptions, LLMResponse } from '../LLMProvider'

/**
 * MockLLMProvider — default provider during development and testing.
 *
 * Benefits:
 * - No API cost
 * - Deterministic output (tests don't flake)
 * - Fast (no network round-trip)
 *
 * Replace with OpenAIProvider or AnthropicProvider in production.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock'
  readonly model = 'mock-v1'

  private readonly response: string

  constructor(
    response = '## Executive Summary\nMock AI response for testing purposes.\n\n## Top 3 Risks\n1. No tests detected\n2. No CI pipeline\n3. No Docker configuration\n\n## Architecture Assessment\nMock assessment.\n\n## Technical Debt\nLow — mock response.\n\n## Engineering Priorities\n1. Add tests\n2. Set up CI\n3. Add Docker'
  ) {
    this.response = response
  }

  async complete(prompt: string, _options?: LLMOptions): Promise<LLMResponse> {
    const start = Date.now()

    // Simulate minimal network delay in dev
    await new Promise((resolve) => setTimeout(resolve, 10))

    return {
      content: this.response,
      model: this.model,
      usage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(this.response.length / 4),
        totalTokens: Math.ceil((prompt.length + this.response.length) / 4),
      },
      durationMs: Date.now() - start,
    }
  }
}
