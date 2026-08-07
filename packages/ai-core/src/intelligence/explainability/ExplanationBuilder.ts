import type { Explanation, Insight, WorkspaceId } from '../../domain'
import type { Evidence, RuleResult } from '@apex/analysis'

export interface ExplainableInsight {
  insight: Insight
  explanation: Explanation
}

/**
 * Builds Explanation entities that link an Insight to its Evidence and Rules.
 * Lives in @apex/ai-core because it produces domain entities (Explanation).
 *
 * Stores evidenceIds (not descriptions) — UI fetches Evidence by ID.
 */
export class ExplanationBuilder {
  build(
    insight: Insight,
    ruleResult: RuleResult,
    evidence: Evidence[],
    workspaceId: WorkspaceId
  ): Explanation {
    const relatedEvidence = evidence.filter((e) => ruleResult.evidenceIds.includes(e.id))

    return {
      id: crypto.randomUUID(),
      workspaceId,
      insightId: insight.id,
      summary: this.buildSummary(ruleResult, relatedEvidence),
      evidenceIds: relatedEvidence.map((e) => e.id),
      appliedRules: [ruleResult.ruleId],
      confidenceReason: `Deterministic rule "${ruleResult.ruleId}" matched with 100% confidence based on static file analysis.`,
      createdAt: new Date(),
    }
  }

  private buildSummary(ruleResult: RuleResult, evidence: Evidence[]): string {
    if (evidence.length === 0) {
      return `Rule "${ruleResult.ruleId}" matched — no direct evidence reference.`
    }
    const facts = evidence.map((e) => `${e.key} = ${JSON.stringify(e.value)}`).join(', ')
    return `Rule "${ruleResult.ruleId}" matched because: ${facts}.`
  }
}
