import type { Insight } from '@apex/ai-core'
import type { WorkspaceId } from '@apex/ai-core'
import type { RuleResult } from '../rules'

/**
 * Maps RuleResults to domain Insight entities.
 * This is the boundary between analysis and domain.
 */
export class InsightMapper {
  toInsights(
    results: RuleResult[],
    workspaceId: WorkspaceId,
    source: Insight['source'] = 'github'
  ): Insight[] {
    return results.map((result) => ({
      id: crypto.randomUUID(),
      workspaceId,
      title: result.title,
      description: result.message,
      confidence: 1,
      severity: result.severity,
      source,
      evidence: result.evidenceIds,
      tags: ['rule-based', result.ruleId],
      createdAt: new Date(),
    }))
  }
}
