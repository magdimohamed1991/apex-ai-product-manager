import type { WorkspaceId } from '../../domain/value-objects'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import type { RecommendationOutcomeRepository } from '../../domain/repositories/RecommendationOutcomeRepository'

/**
 * Epistemic state of a metric (Milestone I - Production Hardening)
 *
 *   - 'unavailable'  : no real observation data exists
 *   - 'estimated'    : derived from declared assumptions / baseline constants
 *   - 'observed'     : derived from real PM decisions / execution outcomes
 *   - 'derived'      : a measurement computed from other observed metrics
 *   - 'validated'    : sufficient data and consistent cross-checks
 */
export type MetricEpistemicState =
  'unavailable' | 'estimated' | 'observed' | 'derived' | 'validated'

export interface TrackedMetric {
  /** Human-readable name, e.g. "Recommendation Acceptance Rate" */
  name: string
  /** Numeric value (or null when no data) */
  value: number | null
  /** One-sentence explanation of what the value means */
  description: string
  /** How was this metric obtained? */
  source:
    'declared_assumption' | 'estimated_baseline' | 'empirical_observation' | 'derived_measurement'
  /** Brief, machine-readable calculation string */
  calculation: string
  /** Number of underlying observations (0 when unavailable) */
  observationCount: number
  /** Confidence bucket (per H7 framework) */
  confidence: 'low' | 'medium' | 'high' | 'insufficient_data'
  /** Epistemic state — drives UI labeling */
  epistemicState: MetricEpistemicState
}

export interface ProductValidationMetrics {
  workspaceId: WorkspaceId
  projectId: string
  generatedAt: Date
  observationCount: number
  /** Decision Quality = approved PM decisions / total recommendations presented */
  decisionAcceptanceRate: TrackedMetric
  /** Outcome Success Rate = verified success outcomes / outcomes tracked */
  outcomeSuccessRate: TrackedMetric
  /** False-Positive Rate = NOT_VERIFIABLE outcomes / total outcomes */
  falsePositiveRate: TrackedMetric
  /** Execution success rate = completed actions / terminal actions */
  executionSuccessRate: TrackedMetric
  /** Measured PM decision latency (s) — undefined if insufficient data */
  measuredDecisionLatencySeconds: TrackedMetric
  /**
   * H7 Confidence states (Milestone I - Production Hardening)
   * - Awaiting PM Telemetry: N < 5
   * - Early Convergence: 5 <= N < 20
   * - High within the APEX operational measurement framework: N >= 20
   */
  confidence: {
    bucket: 'awaiting_pm_telemetry' | 'early_convergence' | 'high_within_apex_framework'
    rationale: string
  }
}

/**
 * H7 Decision Telemetry (Milestone I - Production Hardening)
 *
 * Real telemetry model capturing actual PM decisions on recommendations.
 * Telemetry records the timing, choice, and PM-vs-APEX score delta.
 */

export type PMDecisionKind = 'ACCEPT' | 'REJECT' | 'DEFER' | 'OVERRIDE'

export interface PMDecisionTelemetry {
  id: string
  workspaceId: string
  projectId: string
  recommendationId: string
  category?: string

  recommendationPresentedAt: Date
  decisionStartedAt: Date
  decisionCompletedAt: Date

  decision: PMDecisionKind
  /** PM's explicit priority override value (if any) */
  pmSelectedPriority?: number
  /** APEX calibrated score at the time of decision */
  calibratedH6Score: number
  /** Original H3 baseline */
  originalH3Score: number
  /** Did the PM's choice disagree with the APEX suggestion? */
  overrideOccurred: boolean
  /** |H6 - PM value| when the PM supplied a numeric priority */
  overrideDelta?: number
  /** |APEX rank - PM rank| when the PM re-ranked recommendations */
  rankDisplacement?: number
  recordedAt: Date
}

const DEFAULT_TELEMETRY_BUCKET: ProductValidationMetrics['confidence']['bucket'] =
  'awaiting_pm_telemetry'

function bucketFor(n: number): ProductValidationMetrics['confidence']['bucket'] {
  if (n < 5) return 'awaiting_pm_telemetry'
  if (n < 20) return 'early_convergence'
  return 'high_within_apex_framework'
}

function bucketRationale(b: ProductValidationMetrics['confidence']['bucket']): string {
  switch (b) {
    case 'awaiting_pm_telemetry':
      return 'N < 5: insufficient observations to draw any empirical conclusion.'
    case 'early_convergence':
      return '5 <= N < 20: early convergence within the APEX operational measurement framework. NOT universal statistical significance.'
    case 'high_within_apex_framework':
      return 'N >= 20: high confidence within the APEX operational measurement framework. Still NOT universal statistical significance.'
  }
}

/**
 * Product Validation Service (Milestone H7)
 *
 * Computes empirically-tracked decision-quality metrics. Every metric now
 * carries an explicit epistemic state and a clear source/calculation
 * declaration. Synthetic formulas (e.g. "learning quality" or
 * "business utility" as fixed numbers) have been REMOVED.
 *
 * Distinction:
 *   - Declared assumptions (e.g. 45-minute manual baseline) → `estimated`
 *   - Empirical observations (e.g. observed PM latency) → `observed`
 *   - Derived measurements (e.g. acceptance rate) → `derived`
 *   - "Validated" → never claimed; H7 confidence is bounded by N explicitly.
 */
export class ProductValidationService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly actionRepository: ActionRepository,
    private readonly outcomeRepository: RecommendationOutcomeRepository
  ) {}

  async evaluatePMValue(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ProductValidationMetrics> {
    const recs = await this.productRepository.getRecommendationsByProject(projectId, workspaceId)
    const actions = await this.actionRepository.getByWorkspace({ workspaceId })
    const outcomes = await this.outcomeRepository.getByProject(projectId, workspaceId)

    // Map actions to recs to determine project-scoped actions.
    const projectActionIds = new Set<string>()
    for (const a of actions) {
      if (recs.some((r) => r.id === a.relatedRecommendationId)) {
        projectActionIds.add(a.id)
      }
    }
    const projectActions = actions.filter((a) => projectActionIds.has(a.id))

    // 1. Decision acceptance rate (derived from observations)
    const totalRecommendations = recs.length
    const totalApproved = projectActions.filter((a) => a.status !== 'proposed').length
    const decisionAcceptanceRate: TrackedMetric = {
      name: 'Recommendation Acceptance Rate',
      value: totalRecommendations > 0 ? (totalApproved / totalRecommendations) * 100 : null,
      description:
        'Percent of recommendations that PMs approved (i.e. progressed past `proposed`).',
      source: 'empirical_observation',
      calculation: 'approved_actions / total_recommendations * 100',
      observationCount: totalRecommendations,
      confidence:
        totalRecommendations < 5
          ? 'insufficient_data'
          : totalRecommendations < 20
            ? 'low'
            : 'medium',
      epistemicState: totalRecommendations > 0 ? 'observed' : 'unavailable',
    }

    // 2. Outcome success rate (derived from observations)
    const verifiedSuccessCount = outcomes.filter((o) => o.status === 'VERIFIED_SUCCESS').length
    const totalTrackedOutcomes = outcomes.length
    const outcomeSuccessRate: TrackedMetric = {
      name: 'Outcome Success Rate',
      value: totalTrackedOutcomes > 0 ? (verifiedSuccessCount / totalTrackedOutcomes) * 100 : null,
      description: 'Percent of tracked outcomes that reached `VERIFIED_SUCCESS`.',
      source: 'empirical_observation',
      calculation: 'verified_success_outcomes / total_outcomes * 100',
      observationCount: totalTrackedOutcomes,
      confidence:
        totalTrackedOutcomes < 5
          ? 'insufficient_data'
          : totalTrackedOutcomes < 20
            ? 'low'
            : 'medium',
      epistemicState: totalTrackedOutcomes > 0 ? 'observed' : 'unavailable',
    }

    // 3. False positive rate (derived from observations)
    const falsePositiveCount = outcomes.filter((o) => o.status === 'NOT_VERIFIABLE').length
    const falsePositiveRate: TrackedMetric = {
      name: 'False Positive Rate',
      value: totalTrackedOutcomes > 0 ? (falsePositiveCount / totalTrackedOutcomes) * 100 : null,
      description:
        'Percent of outcomes that the verification system could not confirm as successful.',
      source: 'empirical_observation',
      calculation: 'not_verifiable_outcomes / total_outcomes * 100',
      observationCount: totalTrackedOutcomes,
      confidence:
        totalTrackedOutcomes < 5
          ? 'insufficient_data'
          : totalTrackedOutcomes < 20
            ? 'low'
            : 'medium',
      epistemicState: totalTrackedOutcomes > 0 ? 'observed' : 'unavailable',
    }

    // 4. Execution success rate (derived from real action outcomes)
    const completedActions = projectActions.filter((a) => a.status === 'completed').length
    const terminalActions = projectActions.filter(
      (a) => a.status === 'completed' || a.status === 'failed'
    ).length
    const executionSuccessRate: TrackedMetric = {
      name: 'Execution Success Rate',
      value: terminalActions > 0 ? (completedActions / terminalActions) * 100 : null,
      description:
        'Percent of approved actions that reached `completed` (vs. terminal `failed`). `in-progress` actions are not yet countable.',
      source: 'empirical_observation',
      calculation: 'completed_actions / (completed + failed) * 100',
      observationCount: terminalActions,
      confidence:
        terminalActions < 5 ? 'insufficient_data' : terminalActions < 20 ? 'low' : 'medium',
      epistemicState: terminalActions > 0 ? 'observed' : 'unavailable',
    }

    // 5. Measured PM decision latency (observed, NOT estimated from rec.createdAt -> action.updatedAt)
    // The H7 invariant requires the *actual* decision window. If the system
    // has not yet recorded PMDecisionTelemetry, this metric is "unavailable".
    // The existing rec.createdAt -> action.updatedAt is NOT a real measurement
    // (these are different operations: creation vs. approval at the time of
    // the audit trail). We mark the metric unavailable for now.
    const measuredDecisionLatencySeconds: TrackedMetric = {
      name: 'Measured PM Decision Latency',
      value: null,
      description:
        'Real PM decision latency requires the H7 PMDecisionTelemetry stream (recommendationPresentedAt → decisionCompletedAt). No values are presented until that stream is populated.',
      source: 'empirical_observation',
      calculation: 'decisionCompletedAt - decisionStartedAt (when telemetry is recorded)',
      observationCount: 0,
      confidence: 'insufficient_data',
      epistemicState: 'unavailable',
    }

    const totalObservations = totalRecommendations + totalTrackedOutcomes + terminalActions
    // For brand-new projects with zero observations we still expose the
    // default bucket so the UI has a non-null epistemic anchor.
    const confidenceBucket =
      totalObservations === 0 ? DEFAULT_TELEMETRY_BUCKET : bucketFor(totalObservations)

    return {
      workspaceId,
      projectId,
      generatedAt: new Date(),
      observationCount: totalObservations,
      decisionAcceptanceRate,
      outcomeSuccessRate,
      falsePositiveRate,
      executionSuccessRate,
      measuredDecisionLatencySeconds,
      confidence: {
        bucket: confidenceBucket,
        rationale: bucketRationale(confidenceBucket),
      },
    }
  }
}
