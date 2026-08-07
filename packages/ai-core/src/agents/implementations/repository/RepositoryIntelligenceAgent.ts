import { BaseAgent } from '../../base'
import type { AgentContext } from '../../contracts'
import type { LLMProvider } from '../../../providers'
import type { BudgetPolicy } from '../../../providers'
import { MockLLMProvider, shouldFallbackToMock } from '../../../providers'
import { RepositoryAssessmentValidator } from '../../../validation'
import { RepositoryAssessmentMapper } from './RepositoryAssessmentMapper'
import type { RepositoryAssessmentEntity } from './RepositoryAssessmentMapper'
import type { RepositoryAssessmentRequest } from './RepositoryAssessmentRequest'
import type { RepositoryAssessment } from '@apex/contracts'

export interface RepositoryIntelligenceInput {
  request: RepositoryAssessmentRequest
  dailySpendUsd?: number
}

/**
 * Repository Intelligence Agent
 *
 * Orchestrates: Prompt → Provider → Validate → Retry → Map to Domain
 * No dependency on @apex/prompts — builds prompt inline using contracts only.
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

    const prompt = this.buildPrompt(request)

    // Budget check — fallback to mock if over limit
    const estimatedTokens = Math.ceil(prompt.length / 4)
    const activeProvider = shouldFallbackToMock(this.budgetPolicy, estimatedTokens, dailySpendUsd)
      ? new MockLLMProvider(this.getValidMockResponse())
      : this.provider

    const response = await activeProvider.complete(prompt)
    const assessment = await this.parseAndValidate(response.content, activeProvider, prompt)

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

  private buildPrompt(request: RepositoryAssessmentRequest): string {
    const { repository, insights, evidence } = request

    const summarySection = [
      `Name: ${repository.name}`,
      `Owner: ${repository.owner}`,
      `Languages: ${repository.languages.join(', ')}`,
      `Frameworks: ${repository.frameworks.join(', ') || 'none'}`,
      `Package Manager: ${repository.packageManager}`,
      `TypeScript: ${repository.hasTypeScript}`,
      `CI: ${repository.hasCI}`,
      `Tests: ${repository.hasTests}`,
      `Docker: ${repository.hasDocker}`,
      `Monorepo: ${repository.hasMonorepo}`,
      `Complexity: ${repository.complexity}`,
      `Readiness Score: ${repository.score}/100`,
    ].join('\n')

    const evidenceSection =
      evidence.length > 0
        ? evidence.map((e) => `- [${e.type}] ${e.key}: ${this.safeSerialize(e.value)}`).join('\n')
        : '- No structured evidence available'

    const insightsSection =
      insights.length > 0
        ? insights
            .map((i) => `- [${i.severity?.toUpperCase() ?? 'INFO'}] ${i.title}\n  ${i.description}`)
            .join('\n')
        : '- No static analysis insights available'

    return `You are APEX, an autonomous Product Intelligence system.
Based on the validated repository evidence below, produce an executive engineering assessment.
Do not invent facts. If information is missing, explicitly state that it is unavailable.
Return ONLY valid JSON — no Markdown, no explanation.

## Repository Summary
${summarySection}

## Evidence (structured facts from static analysis)
${evidenceSection}

## Static Analysis Insights
${insightsSection}

## Required JSON Output
{
  "executiveSummary": "string (2-3 sentences)",
  "strengths": ["string"],
  "risks": [{"title":"string","severity":"critical|high|medium|low","description":"string","recommendedAction":"string"}],
  "technicalDebt": {"level":"low|medium|high|critical","reasoning":"string","estimatedEffortDays":number|null},
  "engineeringPriorities": [{"rank":number,"title":"string","rationale":"string","effort":"low|medium|high","impact":"low|medium|high"}],
  "confidence": number
}`
  }

  private safeSerialize(value: unknown): string {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value)
    } catch {
      return '[unserializable]'
    }
  }

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
  ): Promise<RepositoryAssessment> {
    let parsed: unknown

    try {
      parsed = this.validator.parseJSON(content)
    } catch {
      const retry = await provider.complete(originalPrompt)
      parsed = this.validator.parseJSON(retry.content)
    }

    const result = this.validator.validate(parsed)

    if (!result.valid) {
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
