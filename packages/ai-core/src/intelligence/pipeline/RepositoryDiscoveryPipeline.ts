import type { Insight, Finding, Recommendation, Explanation, WorkspaceId } from '../../domain'
import type { RepositoryFiles, RepositorySummary, Evidence, RuleResult } from '@apex/analysis'
import {
  StaticRepositoryAnalyzer,
  EvidenceCollector,
  RuleEngine,
  NoTestsRule,
  NoCIRule,
  NoDockerRule,
  MonorepoDetectedRule,
  NoTypeScriptRule,
  createEvidence,
} from '@apex/analysis'
import { InsightMapper } from '../mappers/InsightMapper'
import { ExplanationBuilder } from '../explainability/ExplanationBuilder'
import { CorrelationEngine, CorrelationFindingBuilder } from '../../correlation'
import {
  RecommendationEngine,
  AddTestingStrategy,
  AddCIStrategy,
  AddTypeScriptStrategy,
  AddressFindingStrategy,
} from '../recommendations'

export interface PipelineInput {
  workspaceId: WorkspaceId
  files: RepositoryFiles
  externalEvidence?: Evidence[]
  /**
   * Project-scoped deterministic identity. When provided, insight and
   * recommendation ids are scoped to the project so two projects inside the
   * same workspace cannot produce colliding ids (and therefore cannot
   * clobber each other's persisted rows on re-analysis).
   */
  projectId?: string
}

export interface PipelineResult {
  summary: RepositorySummary
  evidence: Evidence[]
  insights: Insight[]
  findings: Finding[]
  explanations: Explanation[]
  recommendations: Recommendation[]
  durationMs: number
}

/**
 * RepositoryDiscoveryPipeline — lives in @apex/ai-core.
 * Orchestrates @apex/analysis (low-level) → domain entities (high-level).
 *
 * Files → Analyzer → Evidence → Rules → Insights+Explanations
 *                         ↓
 *                   CorrelationEngine → Findings
 *                         ↓
 *               RecommendationEngine (Insight + Finding strategies)
 *                         ↓
 *                   Recommendations
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
  private readonly correlationEngine = new CorrelationEngine()
  private readonly findingBuilder = new CorrelationFindingBuilder()
  private readonly recommendationEngine = new RecommendationEngine().registerMany([
    new AddTestingStrategy(),
    new AddCIStrategy(),
    new AddTypeScriptStrategy(),
    new AddressFindingStrategy(),
  ])

  run(input: PipelineInput): PipelineResult {
    const start = Date.now()

    const summary = this.analyzer.analyze(input.files)
    const repoEvidence = this.collector.collect(summary)
    const evidence = [...repoEvidence, ...(input.externalEvidence ?? [])]

    // Reject duplicate evidence IDs
    const seenIds = new Set<string>()
    for (const e of evidence) {
      if (seenIds.has(e.id)) {
        throw new Error(
          `Duplicate evidence ID: "${e.id}" — evidence IDs must be globally unique within the workspace`
        )
      }
      seenIds.add(e.id)
    }

    // Validate external evidence provenance at ingestion boundary
    for (const e of input.externalEvidence ?? []) {
      createEvidence(e)
    }

    const ruleResults = this.ruleEngine.evaluate(evidence)

    const { insights, explanations: insightExplanations } = this.buildInsightsWithExplanations(
      ruleResults,
      evidence,
      input.workspaceId,
      input.projectId
    )

    const { findings, explanations: findingExplanations } = this.buildFindings(
      evidence,
      input.workspaceId
    )

    const explanations = [...insightExplanations, ...findingExplanations]

    const recommendations = this.recommendationEngine.generate(
      insights,
      findings,
      input.workspaceId
    )

    return {
      summary,
      evidence,
      insights,
      findings,
      explanations,
      recommendations,
      durationMs: Date.now() - start,
    }
  }

  private buildInsightsWithExplanations(
    ruleResults: RuleResult[],
    evidence: Evidence[],
    workspaceId: WorkspaceId,
    projectId?: string
  ): { insights: Insight[]; explanations: Explanation[] } {
    const insights: Insight[] = []
    const explanations: Explanation[] = []

    for (const result of ruleResults) {
      const [insight] = this.mapper.toInsights([result], workspaceId, 'github', projectId)
      const explanation = this.explanationBuilder.build(insight, result, evidence, workspaceId)
      insight.explanationId = explanation.id
      insights.push(insight)
      explanations.push(explanation)
    }

    return { insights, explanations }
  }

  private buildFindings(
    evidence: Evidence[],
    workspaceId: WorkspaceId
  ): { findings: Finding[]; explanations: Explanation[] } {
    const findings: Finding[] = []
    const explanations: Explanation[] = []
    const correlationResult = this.correlationEngine.evaluate(evidence)

    for (const candidate of correlationResult.candidates) {
      const result = this.findingBuilder.build(candidate, evidence, workspaceId)
      if ('finding' in result) {
        findings.push(result.finding)
        explanations.push(result.explanation)
      }
    }

    return { findings, explanations }
  }
}
