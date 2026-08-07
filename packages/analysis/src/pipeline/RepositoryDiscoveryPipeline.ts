import type { Insight, Recommendation, Explanation, WorkspaceId } from '@apex/ai-core'
import type { RepositoryFiles } from '../repository/StaticRepositoryAnalyzer'
import type { Evidence } from '../evidence'
import type { RepositorySummary } from '../repository/RepositorySummary'
import type { RuleResult } from '../rules'
import { StaticRepositoryAnalyzer } from '../repository/StaticRepositoryAnalyzer'
import { EvidenceCollector } from '../evidence/EvidenceCollector'
import {
  RuleEngine,
  NoTestsRule,
  NoCIRule,
  NoDockerRule,
  MonorepoDetectedRule,
  NoTypeScriptRule,
} from '../rules'
import { InsightMapper } from '../mappers/InsightMapper'
import {
  RecommendationEngine,
  AddTestingStrategy,
  AddCIStrategy,
  AddTypeScriptStrategy,
} from '../recommendations'
import { ExplanationBuilder } from '../explainability/ExplanationBuilder'

export interface PipelineInput {
  workspaceId: WorkspaceId
  files: RepositoryFiles
}

export interface PipelineResult {
  summary: RepositorySummary
  evidence: Evidence[]
  insights: Insight[]
  explanations: Explanation[]
  recommendations: Recommendation[]
  durationMs: number
}

/**
 * RepositoryDiscoveryPipeline orchestrates all analysis layers:
 *
 * Files → Analyzer → Evidence → Rules → Insights+Explanations → Recommendations
 */
export class RepositoryDiscoveryPipeline {
  private readonly analyzer = new StaticRepositoryAnalyzer()
  private readonly collector = new EvidenceCollector()
  private readonly ruleEngine = new RuleEngine().registerMany([
    new NoTestsRule(),
    new NoCIRule(),
    new NoDockerRule(),
    new MonorepoDetectedRule(),
    new NoTypeScriptRule(),
  ])
  private readonly mapper = new InsightMapper()
  private readonly explanationBuilder = new ExplanationBuilder()
  private readonly recommendationEngine = new RecommendationEngine().registerMany([
    new AddTestingStrategy(),
    new AddCIStrategy(),
    new AddTypeScriptStrategy(),
  ])

  run(input: PipelineInput): PipelineResult {
    const start = Date.now()

    const summary = this.analyzer.analyze(input.files)
    const evidence = this.collector.collect(summary)
    const ruleResults = this.ruleEngine.evaluate(evidence)

    const { insights, explanations } = this.buildInsightsWithExplanations(
      ruleResults,
      evidence,
      input.workspaceId
    )

    const recommendations = this.recommendationEngine.generate(insights, input.workspaceId)

    return {
      summary,
      evidence,
      insights,
      explanations,
      recommendations,
      durationMs: Date.now() - start,
    }
  }

  private buildInsightsWithExplanations(
    ruleResults: RuleResult[],
    evidence: Evidence[],
    workspaceId: WorkspaceId
  ): { insights: Insight[]; explanations: Explanation[] } {
    const insights: Insight[] = []
    const explanations: Explanation[] = []

    for (const result of ruleResults) {
      const [insight] = this.mapper.toInsights([result], workspaceId)
      const explanation = this.explanationBuilder.build(insight, result, evidence, workspaceId)
      insight.explanationId = explanation.id
      insights.push(insight)
      explanations.push(explanation)
    }

    return { insights, explanations }
  }
}
