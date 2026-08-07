import type { Evidence } from '@apex/analysis'
import type { CorrelationRule } from '../contracts/CorrelationRule'
import type { CorrelationCandidate } from '../contracts/CorrelationCandidate'
import { scoreCorrelation } from '../scoring'

const MIN_SOURCES = 3

/**
 * Detects signals appearing across 3+ independent sources.
 *
 * Higher confidence comes from source diversity,
 * NOT from proving causation between the signals.
 *
 * Example:
 *   Amplitude + Google Play + GitHub all showing checkout-related signals
 *   → score: 0.70 (three sources, diverse origins)
 */
export class CrossSourceCorrelationRule implements CorrelationRule {
  readonly id = 'cross-source-correlation'
  readonly name = 'Cross-Source Correlation (3+ sources)'

  evaluate(evidence: Evidence[]): CorrelationCandidate[] {
    // Group by source
    const bySource = new Map<string, Evidence[]>()
    for (const e of evidence) {
      const list = bySource.get(e.source) ?? []
      list.push(e)
      bySource.set(e.source, list)
    }

    if (bySource.size < MIN_SOURCES) return []

    // Find sources with at least one evidence item
    const activeSources = [...bySource.entries()].filter(([, items]) => items.length > 0)
    if (activeSources.length < MIN_SOURCES) return []

    const allEvidence = activeSources.flatMap(([, items]) => items)
    const sourceTypes = activeSources.map(
      ([source]) => source
    ) as CorrelationCandidate['sourceTypes']

    return [
      {
        id: `${this.id}:${sourceTypes.sort().join('-')}`,
        evidenceIds: allEvidence.map((e) => e.id),
        sourceTypes,
        score: scoreCorrelation(sourceTypes, allEvidence, 0.6),
        reason: `Signals were detected across ${activeSources.length} independent sources (${sourceTypes.join(', ')}). Higher confidence from source diversity — not from proven causation. Cross-referencing these signals may surface a common underlying issue.`,
        ruleId: this.id,
        createdAt: new Date(),
      },
    ]
  }
}
