import type { Evidence } from '@apex/analysis'
import type { CorrelationRule } from '../contracts/CorrelationRule'
import type { CorrelationCandidate } from '../contracts/CorrelationCandidate'
import { scoreCorrelation, hasTemporalOverlap } from '../scoring'

/**
 * Detects correlation between metric degradation and customer reviews.
 *
 * Pattern: Amplitude metric drops ↓ + App Store / Google Play complaints ↑
 *
 * Does NOT claim causation. Reason is phrased as temporal overlap,
 * not as "reviews caused the metric drop" or vice versa.
 */
export class MetricReviewCorrelationRule implements CorrelationRule {
  readonly id = 'metric-review-correlation'
  readonly name = 'Metric + Review Correlation'

  evaluate(evidence: Evidence[]): CorrelationCandidate[] {
    const metricEvidence = evidence.filter(
      (e) => e.source === 'amplitude' && this.isNegativeMetric(e)
    )
    const reviewEvidence = evidence.filter(
      (e) => (e.source === 'google_play' || e.source === 'app_store') && this.isNegativeReview(e)
    )

    if (metricEvidence.length === 0 || reviewEvidence.length === 0) return []

    const candidates: CorrelationCandidate[] = []

    for (const metric of metricEvidence) {
      const temporalReviews = reviewEvidence.filter((r) => hasTemporalOverlap([metric], [r]))
      if (temporalReviews.length === 0) continue

      const allEvidence = [metric, ...temporalReviews]
      const sourceTypes = [
        ...new Set(allEvidence.map((e) => e.source)),
      ] as CorrelationCandidate['sourceTypes']

      candidates.push({
        id: `${this.id}:${metric.id}`,
        evidenceIds: allEvidence.map((e) => e.id),
        sourceTypes,
        score: scoreCorrelation(sourceTypes, allEvidence, 0.8),
        reason: `A metric signal from ${metric.source} and ${temporalReviews.length} review signal(s) from store(s) overlap within the same time window. This may indicate a shared user-facing issue — further investigation recommended.`,
        ruleId: this.id,
        createdAt: new Date(),
      })
    }

    return candidates
  }

  private isNegativeMetric(e: Evidence): boolean {
    // Evidence value can be a negative number (drop) or a flag
    if (typeof e.value === 'number') return e.value < 0
    if (typeof e.value === 'object' && e.value !== null) {
      const v = e.value as Record<string, unknown>
      return typeof v.change === 'number' && v.change < 0
    }
    return false
  }

  private isNegativeReview(e: Evidence): boolean {
    if (typeof e.value === 'number') return e.value > 0 // count of complaints
    return e.type === 'review'
  }
}
