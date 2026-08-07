import { BaseAgent } from '../base'
import type { AgentContext } from '../contracts'
import type { Insight } from '../../domain'
import type { RepositoryFiles } from '@apex/analysis'
import { StaticRepositoryAnalyzer } from '@apex/analysis'
import type { RepositorySummary } from '@apex/analysis'

export interface RepositoryDiscoveryInput {
  repositoryUrl: string
  files: RepositoryFiles
}

export interface RepositoryDiscoveryOutput {
  summary: RepositorySummary
  insights: Insight[]
}

/**
 * Repository Discovery Agent
 *
 * No LLM — pure static analysis.
 * Analyzes repository structure and produces structured Insights.
 */
export class RepositoryDiscoveryAgent extends BaseAgent<
  RepositoryDiscoveryInput,
  RepositoryDiscoveryOutput
> {
  readonly id = 'repository-discovery'
  readonly name = 'Repository Discovery Agent'
  readonly version = '1.0.0'

  private readonly analyzer = new StaticRepositoryAnalyzer()

  protected async run(
    input: RepositoryDiscoveryInput,
    context: AgentContext
  ): Promise<RepositoryDiscoveryOutput> {
    const summary = this.analyzer.analyze(input.files)
    const insights = this.generateInsights(summary, context)

    return { summary, insights }
  }

  private generateInsights(summary: RepositorySummary, context: AgentContext): Insight[] {
    const now = new Date()
    const insights: Insight[] = []

    const add = (
      title: string,
      description: string,
      confidence: number,
      severity: Insight['severity']
    ) => {
      insights.push({
        id: crypto.randomUUID(),
        workspaceId: context.workspaceId,
        title,
        description,
        confidence,
        severity,
        source: 'github',
        evidence: [],
        tags: ['static-analysis', 'repository'],
        createdAt: now,
      })
    }

    // Positive signals
    if (summary.hasTypeScript)
      add('Project uses TypeScript', 'Strong type safety is in place.', 1, 'info')

    if (summary.hasMonorepo)
      add('Monorepo architecture detected', `Uses ${summary.packageManager} workspaces.`, 1, 'info')

    if (summary.hasCI)
      add('CI pipeline configured', 'Automated checks run on every commit.', 1, 'info')

    if (summary.hasTailwind)
      add('Tailwind CSS detected', 'Utility-first CSS framework in use.', 1, 'info')

    // Risk signals
    if (!summary.hasTests)
      add(
        'No automated tests detected',
        'The repository has no Jest or Vitest configuration.',
        0.9,
        'high'
      )

    if (!summary.hasCI)
      add(
        'No CI pipeline found',
        'Changes are not automatically validated before merging.',
        0.9,
        'medium'
      )

    if (!summary.hasDocker)
      add(
        'No Dockerfile found',
        'The project may lack a consistent deployment environment.',
        0.8,
        'low'
      )

    // Score insight
    add(
      `Repository readiness score: ${summary.score}/100`,
      `Complexity: ${summary.complexity}. Frameworks: ${summary.frameworks.join(', ') || 'none detected'}.`,
      1,
      summary.score >= 80 ? 'info' : summary.score >= 60 ? 'medium' : 'high'
    )

    return insights
  }
}
