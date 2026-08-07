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
    response = JSON.stringify({
      executiveSummary:
        'The repository shows solid TypeScript adoption and CI configuration. Key gaps include missing automated tests.',
      strengths: ['TypeScript configured', 'CI pipeline present'],
      risks: [
        {
          title: 'No automated tests',
          severity: 'high',
          description: 'No test framework detected.',
          recommendedAction: 'Add Vitest for unit testing.',
        },
      ],
      technicalDebt: {
        level: 'medium',
        reasoning: 'Missing tests increase deployment risk.',
        estimatedEffortDays: 5,
      },
      engineeringPriorities: [
        {
          rank: 1,
          title: 'Add automated tests',
          rationale: 'Reduces deployment risk significantly.',
          effort: 'medium',
          impact: 'high',
        },
      ],
      confidence: 0.82,
    })
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
