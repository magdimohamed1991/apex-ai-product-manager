import type { InsightDTO, FindingDTO, RecommendationDTO, ExplanationDTO } from '@apex/contracts'
import type { RepositorySummary, Evidence } from '@apex/analysis'

/**
 * Variables injected into repository prompt templates.
 * Uses lightweight DTOs from @apex/contracts — no dependency on @apex/ai-core.
 */
export interface RepositoryPromptVariables {
  summary: RepositorySummary
  evidence: Evidence[]
  insights: InsightDTO[]
  findings: FindingDTO[]
  recommendations: RecommendationDTO[]
  explanations: ExplanationDTO[]
}

export function serializeSummary(summary: RepositorySummary): string {
  return [
    `Name: ${summary.name}`,
    `Owner: ${summary.owner}`,
    `Languages: ${summary.languages.join(', ') || 'unknown'}`,
    `Frameworks: ${summary.frameworks.join(', ') || 'none'}`,
    `Package Manager: ${summary.packageManager}`,
    `TypeScript: ${summary.hasTypeScript}`,
    `CI: ${summary.hasCI}`,
    `Tests: ${summary.hasTests}`,
    `Docker: ${summary.hasDocker}`,
    `Monorepo: ${summary.hasMonorepo}`,
    `Complexity: ${summary.complexity}`,
    `Readiness Score: ${summary.score}/100`,
  ].join('\n')
}

export function serializeEvidence(evidence: Evidence[]): string {
  if (evidence.length === 0) return '- No structured evidence available'
  return evidence.map((e) => `- [${e.type}] ${e.key}: ${JSON.stringify(e.value)}`).join('\n')
}

export function serializeInsights(insights: InsightDTO[]): string {
  if (insights.length === 0) return '- No static analysis insights available'
  return insights
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.title}\n  ${i.description}`)
    .join('\n')
}

export function serializeFindings(findings: FindingDTO[]): string {
  if (findings.length === 0) return '- No correlation findings'
  return findings
    .map(
      (f) =>
        `- [${f.severity.toUpperCase()}/${f.type}] ${f.title}\n  ${f.description}\n  Evidence: ${f.evidenceIds.join(', ') || 'none'}${f.correlationId ? `\n  Correlation: ${f.correlationId}` : ''}`
    )
    .join('\n')
}

export function serializeRecommendations(recommendations: RecommendationDTO[]): string {
  if (recommendations.length === 0) return '- No recommendations generated'
  return recommendations
    .map(
      (r) =>
        `- [${r.priority.toUpperCase()}] ${r.title}\n  Rationale: ${r.rationale}\n  Impact: ${r.impact} | Effort: ${r.effort} | Origin: ${r.origin}` +
        (r.findingIds?.length ? `\n  Findings: ${r.findingIds.join(', ')}` : '') +
        (r.insightIds?.length ? `\n  Insights: ${r.insightIds.join(', ')}` : '')
    )
    .join('\n')
}

export function serializeExplanations(explanations: ExplanationDTO[]): string {
  if (explanations.length === 0) return '- No explanations available'
  return explanations
    .map(
      (e) =>
        `- ${e.summary}\n  Evidence: ${e.evidenceIds.join(', ') || 'none'}\n  Rules: ${e.appliedRules.join(', ')}\n  Confidence: ${e.confidenceReason}`
    )
    .join('\n')
}
