import { BaseAgent } from '../../base'
import type { AgentContext } from '../../contracts'
import type { LLMProvider } from '../../../providers'
import type { BudgetPolicy } from '../../../providers'
import { MockLLMProvider, shouldFallbackToMock } from '../../../providers'
import { RepositoryAssessmentValidator } from '../../../validation'
import { RepositoryAssessmentMapper } from './RepositoryAssessmentMapper'
import type { RepositoryAssessmentEntity } from './RepositoryAssessmentMapper'
import type { RepositoryAssessmentRequest } from './RepositoryAssessmentRequest'
import { PromptRenderer } from '@apex/prompts'
import type { RepositoryAssessment } from '@apex/prompts'

export interface RepositoryIntelligenceInput {
  request: RepositoryAssessmentRequest
  dailySpendUsd?: number
}

/**
 * Repository Intelligence Agent
 *
 * Orchestrates: Prompt → Provider → Validate → Retry → Map to Domain
 * Never exposes raw LLM output outside this class.
 */
export class RepositoryIntelligenceAgent extends BaseAgent<
  RepositoryIntelligenceInput,
  RepositoryAssessmentEntity
> {
  readonly id = 'repository-intelligence'
  readonly name = 'Repository Intelligence Agent'
  readonly version = '1.0.0'

  private readonly renderer = new PromptRenderer()
  private readonly validator = new RepositoryAssessmentValidator()
  private readonly mapper = new RepositoryAssessmentMapper()

  constructor(
    private readonly provider: LLMProvider,
    private readonly budgetPolicy: BudgetPolicy,
    private readonly promptVersion = 'v1'
  ) {
    super()
  }

  protected async run(
    input: RepositoryIntelligenceInput,
    context: AgentContext
  ): Promise<RepositoryAssessmentEntity> {
    const { request, dailySpendUsd = 0 } = input

    // Render prompt with typed variables
    const rendered = this.renderer.renderRepositoryIntelligence(
      {
        summary: request.repository,
        evidence: [],
        insights: request.insights,
      },
      this.promptVersion
    )

    // Budget check — fallback to mock if over limit
    const estimatedTokens = Math.ceil(rendered.content.length / 4)
    const activeProvider = shouldFallbackToMock(this.budgetPolicy, estimatedTokens, dailySpendUsd)
      ? new MockLLMProvider()
      : this.provider

    // First attempt
    const response = await activeProvider.complete(rendered.content)
    const assessment = await this.parseAndValidate(
      response.content,
      activeProvider,
      rendered.content
    )

    return this.mapper.toDomain(assessment, context.workspaceId, {
      provider: activeProvider.name,
      model: activeProvider.model,
      promptVersion: this.promptVersion,
      tokenUsage: {
        prompt: response.usage.promptTokens,
        completion: response.usage.completionTokens,
        total: response.usage.totalTokens,
      },
    })
  }

  private async parseAndValidate(
    content: string,
    provider: LLMProvider,
    originalPrompt: string
  ): Promise<RepositoryAssessment> {
    let parsed: unknown

    try {
      parsed = this.validator.parseJSON(content)
    } catch {
      // Retry once on JSON parse failure
      const retry = await provider.complete(originalPrompt)
      parsed = this.validator.parseJSON(retry.content)
    }

    const result = this.validator.validate(parsed)

    if (!result.valid) {
      // Retry once on validation failure
      const retry = await provider.complete(originalPrompt)
      const reparsed = this.validator.parseJSON(retry.content)
      const retryResult = this.validator.validate(reparsed)

      if (!retryResult.valid) {
        throw new Error(
          `LLM output failed validation after retry: ${retryResult.errors.join(', ')}`
        )
      }

      return reparsed as RepositoryAssessment
    }

    return parsed as RepositoryAssessment
  }
}
