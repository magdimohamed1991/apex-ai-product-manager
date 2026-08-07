import type { Evidence } from '@apex/analysis'
import type { CorrelationRule } from './contracts/CorrelationRule'
import type { CorrelationResult } from './contracts/CorrelationResult'
import type { CorrelationCandidate } from './contracts/CorrelationCandidate'
import { MetricReviewCorrelationRule } from './rules/MetricReviewCorrelationRule'
import { MetricCodeCorrelationRule } from './rules/MetricCodeCorrelationRule'
import { CrossSourceCorrelationRule } from './rules/CrossSourceCorrelationRule'

/**
 * Orchestrates correlation rules over a set of Evidence.
 * Returns ranked CorrelationCandidates — NOT Findings.
 *
 * The Engine detects patterns. A downstream process converts
 * candidates to Findings after human-readable validation.
 */
export class CorrelationEngine {
  private readonly rules: CorrelationRule[]

  constructor(rules?: CorrelationRule[]) {
    this.rules = rules ?? [
      new MetricReviewCorrelationRule(),
      new MetricCodeCorrelationRule(),
      new CrossSourceCorrelationRule(),
    ]
  }

  evaluate(evidence: Evidence[]): CorrelationResult {
    const allCandidates: CorrelationCandidate[] = []

    for (const rule of this.rules) {
      const candidates = rule.evaluate(evidence)
      allCandidates.push(...candidates)
    }

    // Deduplicate by id and sort by score descending
    const seen = new Set<string>()
    const unique = allCandidates
      .filter((c) => {
        if (seen.has(c.id)) return false
        seen.add(c.id)
        return true
      })
      .sort((a, b) => b.score - a.score)

    return {
      candidates: unique,
      evaluatedEvidenceCount: evidence.length,
      rulesEvaluated: this.rules.length,
      generatedAt: new Date(),
    }
  }

  register(rule: CorrelationRule): this {
    this.rules.push(rule)
    return this
  }
}
