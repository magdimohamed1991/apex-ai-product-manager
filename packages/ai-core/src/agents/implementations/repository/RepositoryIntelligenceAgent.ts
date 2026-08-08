import { BaseAgent } from '../../base'
import type { AgentContext } from '../../contracts'
import type { LLMProvider } from '../../../providers'
import type { BudgetPolicy } from '../../../providers'
import { MockLLMProvider, shouldFallbackToMock } from '../../../providers'
import { RepositoryAssessmentValidator } from '../../../validation'
import { RepositoryAssessmentMapper } from './RepositoryAssessmentMapper'
import type { RepositoryAssessmentEntity } from './RepositoryAssessmentMapper'
import type { RepositoryAssessmentRequest } from './RepositoryAssessmentRequest'
import type {
  RepositoryAssessment,
  InsightDTO,
  FindingDTO,
  RecommendationDTO,
  ExplanationDTO,
} from '@apex/contracts'
import { promptRegistry } from '@apex/prompts'

interface ParseResult {
  assessment: RepositoryAssessment
  retryUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
  attempts: number
}

export interface RepositoryIntelligenceInput {
  request: RepositoryAssessmentRequest
  dailySpendUsd?: number
}

/**
 * Repository Intelligence Agent
 *
 * Orchestrates: PromptRegistry → Provider → Validate → Retry → Map to Domain
 *
 * Prompt construction is delegated to @apex/prompts (PromptRegistry + PromptRenderer).
 * This is the single canonical prompt path — no inline prompt building in agents.
 *
 * The full intelligence pipeline output is consumed:
 *   - repository summary + evidence (static analysis)
 *   - insights (rule engine)
 *   - findings + recommendations (correlation + strategy layer)
 *   - explanations (provenance layer)
 *
 * Domain entities are mapped to lightweight DTOs before being handed to @apex/prompts,
 * preserving the dependency direction: prompts never imports from ai-core.
 */
export class RepositoryIntelligenceAgent extends BaseAgent<
  RepositoryIntelligenceInput,
  RepositoryAssessmentEntity
> {
  readonly id = 'repository-intelligence'
  readonly name = 'Repository Intelligence Agent'
  readonly version = '1.0.0'

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

    const rendered = promptRegistry.get(
      'repository-intelligence',
      {
        summary: request.repository,
        evidence: request.evidence,
        insights: this.toInsightDTOs(request.insights),
        findings: this.toFindingDTOs(request.findings),
        recommendations: this.toRecommendationDTOs(request.recommendations),
        explanations: this.toExplanationDTOs(request.explanations),
      },
      this.promptVersion
    )

    const prompt = rendered.content

    // Budget check — fallback to mock if over limit
    const estimatedTokens = Math.ceil(prompt.length / 4)
    const activeProvider = shouldFallbackToMock(this.budgetPolicy, estimatedTokens, dailySpendUsd)
      ? new MockLLMProvider(this.getValidMockResponse())
      : this.provider

    const response = await activeProvider.complete(prompt, {
      maxTokens: this.budgetPolicy.maxTokensPerRequest,
    })
    const parseResult = await this.parseAndValidate(response.content, activeProvider, prompt)

    return this.mapper.toDomain(parseResult.assessment, context.workspaceId, {
      provider: activeProvider.name,
      model: activeProvider.model,
      promptVersion: this.promptVersion,
      tokenUsage: {
        prompt: response.usage.promptTokens + parseResult.retryUsage.promptTokens,
        completion: response.usage.completionTokens + parseResult.retryUsage.completionTokens,
        total: response.usage.totalTokens + parseResult.retryUsage.totalTokens,
      },
    })
  }

  // ── DTO mappers ──────────────────────────────────────────────────────────────
  // Domain entities from @apex/ai-core are converted to lightweight DTOs
  // from @apex/contracts before being passed to @apex/prompts.
  // This preserves the dependency direction: prompts → contracts, never prompts → ai-core.

  private toInsightDTOs(insights: RepositoryAssessmentRequest['insights']): InsightDTO[] {
    return insights.map((insight) => ({
      id: insight.id,
      title: insight.title,
      description: insight.description,
      severity: insight.severity,
      confidence: insight.confidence,
      source: insight.source,
      tags: insight.tags,
    }))
  }

  private toFindingDTOs(findings: RepositoryAssessmentRequest['findings']): FindingDTO[] {
    return findings.map((finding) => ({
      id: finding.id,
      type: finding.type,
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      priority: finding.priority,
      evidenceIds: finding.evidenceIds,
      correlationId: finding.correlationId,
    }))
  }

  private toRecommendationDTOs(
    recommendations: RepositoryAssessmentRequest['recommendations']
  ): RecommendationDTO[] {
    return recommendations.map((rec) => ({
      id: rec.id,
      title: rec.title,
      rationale: rec.rationale,
      impact: rec.impact,
      effort: rec.effort,
      priority: rec.priority,
      confidence: rec.confidence,
      origin: rec.origin,
      insightIds: rec.insightIds,
      findingIds: rec.findingIds,
    }))
  }

  private toExplanationDTOs(
    explanations: RepositoryAssessmentRequest['explanations']
  ): ExplanationDTO[] {
    return explanations.map((exp) => ({
      id: exp.id,
      summary: exp.summary,
      evidenceIds: exp.evidenceIds,
      appliedRules: exp.appliedRules,
      confidenceReason: exp.confidenceReason,
      insightIds: exp.insightIds,
      findingIds: exp.findingIds,
    }))
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private getValidMockResponse(): string {
    return JSON.stringify({
      executiveSummary:
        'The repository shows solid TypeScript adoption and CI configuration. Key gaps include missing automated tests and Docker configuration.',
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
  }

  private async parseAndValidate(
    content: string,
    provider: LLMProvider,
    originalPrompt: string
  ): Promise<ParseResult> {
    let parsed: unknown
    let attempts = 1
    let retryPromptTokens = 0
    let retryCompletionTokens = 0

    try {
      parsed = this.validator.parseJSON(content)
    } catch {
      attempts++
      const retry = await provider.complete(originalPrompt, {
        maxTokens: this.budgetPolicy.maxTokensPerRequest,
      })
      retryPromptTokens += retry.usage.promptTokens
      retryCompletionTokens += retry.usage.completionTokens
      parsed = this.validator.parseJSON(retry.content)
    }

    const result = this.validator.validate(parsed)

    if (!result.valid) {
      attempts++
      const retry = await provider.complete(originalPrompt, {
        maxTokens: this.budgetPolicy.maxTokensPerRequest,
      })
      retryPromptTokens += retry.usage.promptTokens
      retryCompletionTokens += retry.usage.completionTokens
      const reparsed = this.validator.parseJSON(retry.content)
      const retryResult = this.validator.validate(reparsed)

      if (!retryResult.valid) {
        throw new Error(
          `LLM output failed validation after retry: ${retryResult.errors.join(', ')}`
        )
      }
      return {
        assessment: reparsed as RepositoryAssessment,
        retryUsage: {
          promptTokens: retryPromptTokens,
          completionTokens: retryCompletionTokens,
          totalTokens: retryPromptTokens + retryCompletionTokens,
        },
        attempts,
      }
    }

    return {
      assessment: parsed as RepositoryAssessment,
      retryUsage: {
        promptTokens: retryPromptTokens,
        completionTokens: retryCompletionTokens,
        totalTokens: retryPromptTokens + retryCompletionTokens,
      },
      attempts,
    }
  }
}
