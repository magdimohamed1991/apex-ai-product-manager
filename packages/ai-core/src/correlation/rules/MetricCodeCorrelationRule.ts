import type { Evidence } from '@apex/analysis'
import type { CorrelationRule } from '../contracts/CorrelationRule'
import type { CorrelationCandidate } from '../contracts/CorrelationCandidate'
import { scoreCorrelation, hasTemporalOverlap } from '../scoring'

/**
 * Detects correlation between metric degradation and recent code changes.
 *
 * Pattern: Amplitude metric drops ↓ + GitHub changes in related area
 *
 * IMPORTANT: Does NOT imply causation.
 * The reason is always phrased as temporal overlap.
 */
export class MetricCodeCorrelationRule implements CorrelationRule {
  readonly id = 'metric-code-correlation'
  readonly name = 'Metric + Code Change Correlation'

  evaluate(evidence: Evidence[]): CorrelationCandidate[] {
    const metricEvidence = evidence.filter(
      (e) => e.source === 'amplitude' && this.isNegativeMetric(e)
    )
    const codeEvidence = evidence.filter((e) => e.source === 'github')

    if (metricEvidence.length === 0 || codeEvidence.length === 0) return []

    const candidates: CorrelationCandidate[] = []

    for (const metric of metricEvidence) {
      const temporalCode = codeEvidence.filter((c) => hasTemporalOverlap([metric], [c]))
      if (temporalCode.length === 0) continue

      const allEvidence = [metric, ...temporalCode]
      const sourceTypes = [
        ...new Set(allEvidence.map((e) => e.source)),
      ] as CorrelationCandidate['sourceTypes']

      candidates.push({
        id: `${this.id}:${metric.id}`,
        evidenceIds: allEvidence.map((e) => e.id),
        sourceTypes,
        score: scoreCorrelation(sourceTypes, allEvidence, 0.7),
        reason: `Recent code changes in ${metric.source === 'amplitude' ? 'the codebase' : metric.source} temporally overlap with a metric signal from Amplitude. Temporal overlap does not imply causation — review the changes for potential impact.`,
        ruleId: this.id,
        createdAt: new Date(),
      })
    }

    return candidates
  }

  private isNegativeMetric(e: Evidence): boolean {
    if (typeof e.value === 'number') return e.value < 0
    if (typeof e.value === 'object' && e.value !== null) {
      const v = e.value as Record<string, unknown>
      return typeof v.change === 'number' && v.change < 0
    }
    return false
  }
}
