import type { Insight, WorkspaceId } from '../../domain'
import type { RuleResult } from '@apex/analysis'

/**
 * Maps RuleResults to domain Insight entities.
 * This is the boundary between @apex/analysis (rules) and @apex/ai-core (domain).
 */
export class InsightMapper {
  toInsights(
    results: RuleResult[],
    workspaceId: WorkspaceId,
    source: Insight['source'] = 'github',
    projectId?: string
  ): Insight[] {
    return results.map((result) => ({
      // Enforce deterministic stable Insight ID across pipeline runs (Item 7).
      // The id MUST be project-scoped: two projects in the SAME workspace
      // analyzing the same repository shape previously produced identical
      // insight ids, which propagated into identical recommendation ids and
      // made one project's persisted rows clobber the other's (cross-project
      // data loss within a tenant). projectId is appended when provided.
      id: `ins-${workspaceId}${projectId ? `-${projectId}` : ''}-${result.ruleId}`,
      workspaceId,
      title: result.title,
      description: result.message,
      confidence: 1,
      severity: result.severity,
      source,
      evidenceIds: result.evidenceIds,
      tags: ['rule-based', result.ruleId],
      createdAt: new Date(),
    }))
  }
}
