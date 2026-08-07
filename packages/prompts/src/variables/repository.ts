import type { InsightDTO } from '@apex/contracts'
import type { RepositorySummary, Evidence } from '@apex/analysis'

/**
 * Variables injected into repository prompt templates.
 * Uses InsightDTO from @apex/contracts — no dependency on @apex/ai-core.
 */
export interface RepositoryPromptVariables {
  summary: RepositorySummary
  evidence: Evidence[]
  insights: InsightDTO[]
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
  return evidence.map((e) => `- [${e.type}] ${e.key}: ${JSON.stringify(e.value)}`).join('\n')
}

export function serializeInsights(insights: InsightDTO[]): string {
  return insights
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.title}\n  ${i.description}`)
    .join('\n')
}
