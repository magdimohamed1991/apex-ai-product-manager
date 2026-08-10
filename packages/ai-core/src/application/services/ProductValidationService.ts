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
  /**
   * PM Decision Metrics — derived ONLY from the PMDecisionTelemetry
   * population (ACCEPT / REJECT / DEFER / OVERRIDE records). Never mixed
   * with recommendations, actions, or outcomes.
   */
  /** Acceptance = ACCEPT telemetry / total decision telemetry */
  decisionAcceptanceRate: TrackedMetric
  /** Rejection = REJECT telemetry / total decision telemetry */
  decisionRejectionRate: TrackedMetric
  /** Defer = DEFER telemetry / total decision telemetry */
  decisionDeferRate: TrackedMetric
  /** Override = OVERRIDE telemetry / total decision telemetry */
  decisionOverrideRate: TrackedMetric
  /** Mean |H6 - PM priority| over OVERRIDE telemetry with a numeric priority */
  meanPriorityOverrideDelta: TrackedMetric
  /** Measured PM decision latency (s) — observed only, never estimated */
  measuredDecisionLatencySeconds: TrackedMetric
  /** Outcome Metrics — verified success outcomes / outcomes tracked */
  outcomeSuccessRate: TrackedMetric
  /** Outcome Metrics — NOT_VERIFIABLE outcomes / total outcomes */
  unverifiableRate: TrackedMetric
  /** Execution Metrics — completed actions / terminal actions */
  executionSuccessRate: TrackedMetric
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
 * H7 Decision Telemetry types now live in the domain layer
 * (`@apex/ai-core/src/domain/entities/PMDecisionTelemetry.ts`) so the
 * persistence layer can store them without depending on application
 * services. Re-exported here for backward compatibility with importers.
 */
export type { PMDecisionTelemetry, PMDecisionKind } from '../../domain/entities'
export { validatePMDecisionTelemetry } from '../../domain/entities'

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

    // Map actions to recs to determine project-scoped actions (execution
    // metrics population — kept separate from PM decision metrics).
    const projectActionIds = new Set<string>()
    for (const a of actions) {
      if (recs.some((r) => r.id === a.relatedRecommendationId)) {
        projectActionIds.add(a.id)
      }
    }
    const projectActions = actions.filter((a) => projectActionIds.has(a.id))

    // 1. PM Decision Metrics — derived ONLY from the PMDecisionTelemetry
    //    population. The acceptance rate is ACCEPT telemetry / total
    //    decision telemetry. It must NEVER mix recommendations, actions,
    //    or outcomes into the denominator (H7 measurement integrity).
    const telemetry = await this.productRepository.getPMDecisionTelemetryByProject(
      projectId,
      workspaceId
    )
    const decisionCount = telemetry.length
    const acceptCount = telemetry.filter((t) => t.decision === 'ACCEPT').length
    const rejectCount = telemetry.filter((t) => t.decision === 'REJECT').length
    const deferCount = telemetry.filter((t) => t.decision === 'DEFER').length
    const overrideCount = telemetry.filter((t) => t.decision === 'OVERRIDE').length

    const decisionAcceptanceRate: TrackedMetric = {
      name: 'PM Decision Acceptance Rate',
      value: decisionCount > 0 ? (acceptCount / decisionCount) * 100 : null,
      description:
        'Percent of PM decision telemetry records that were ACCEPT decisions (ACCEPT telemetry / total decision telemetry).',
      source: 'empirical_observation',
      calculation: 'accept_telemetry / total_decision_telemetry * 100',
      observationCount: decisionCount,
      confidence:
        decisionCount === 0
          ? 'insufficient_data'
          : decisionCount < 5
            ? 'insufficient_data'
            : decisionCount < 20
              ? 'low'
              : 'medium',
      epistemicState: decisionCount > 0 ? 'observed' : 'unavailable',
    }

    const decisionRejectionRate: TrackedMetric = {
      name: 'PM Decision Rejection Rate',
      value: decisionCount > 0 ? (rejectCount / decisionCount) * 100 : null,
      description: 'Percent of PM decision telemetry records that were REJECT decisions.',
      source: 'empirical_observation',
      calculation: 'reject_telemetry / total_decision_telemetry * 100',
      observationCount: decisionCount,
      confidence:
        decisionCount === 0
          ? 'insufficient_data'
          : decisionCount < 5
            ? 'insufficient_data'
            : decisionCount < 20
              ? 'low'
              : 'medium',
      epistemicState: decisionCount > 0 ? 'observed' : 'unavailable',
    }

    const decisionDeferRate: TrackedMetric = {
      name: 'PM Decision Defer Rate',
      value: decisionCount > 0 ? (deferCount / decisionCount) * 100 : null,
      description: 'Percent of PM decision telemetry records that were DEFER decisions.',
      source: 'empirical_observation',
      calculation: 'defer_telemetry / total_decision_telemetry * 100',
      observationCount: decisionCount,
      confidence:
        decisionCount === 0
          ? 'insufficient_data'
          : decisionCount < 5
            ? 'insufficient_data'
            : decisionCount < 20
              ? 'low'
              : 'medium',
      epistemicState: decisionCount > 0 ? 'observed' : 'unavailable',
    }

    const decisionOverrideRate: TrackedMetric = {
      name: 'PM Decision Override Rate',
      value: decisionCount > 0 ? (overrideCount / decisionCount) * 100 : null,
      description: 'Percent of PM decision telemetry records that were OVERRIDE decisions.',
      source: 'empirical_observation',
      calculation: 'override_telemetry / total_decision_telemetry * 100',
      observationCount: decisionCount,
      confidence:
        decisionCount === 0
          ? 'insufficient_data'
          : decisionCount < 5
            ? 'insufficient_data'
            : decisionCount < 20
              ? 'low'
              : 'medium',
      epistemicState: decisionCount > 0 ? 'observed' : 'unavailable',
    }

    const deltaTelemetry = telemetry.filter(
      (t) => t.decision === 'OVERRIDE' && t.overrideDelta !== undefined
    )
    const meanPriorityOverrideDelta: TrackedMetric = {
      name: 'Mean Priority Override Delta',
      value:
        deltaTelemetry.length > 0
          ? Math.round(
              (deltaTelemetry.reduce((a, t) => a + (t.overrideDelta as number), 0) /
                deltaTelemetry.length) *
                100
            ) / 100
          : null,
      description:
        'Mean |calibrated H6 score - PM selected priority| over OVERRIDE telemetry records that carry a numeric priority.',
      source: 'empirical_observation',
      calculation: 'mean(|h6_score - pm_selected_priority|) over override telemetry',
      observationCount: deltaTelemetry.length,
      confidence:
        deltaTelemetry.length === 0
          ? 'insufficient_data'
          : deltaTelemetry.length < 5
            ? 'insufficient_data'
            : deltaTelemetry.length < 20
              ? 'low'
              : 'medium',
      epistemicState: deltaTelemetry.length > 0 ? 'observed' : 'unavailable',
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

    // 3. Unverifiable rate (derived from observations). NOT_VERIFIABLE
    //    means the system could not confirm success — labeling it a "false
    //    positive" would claim the recommendation was wrong, which is a
    //    different epistemic statement.
    const unverifiableCount = outcomes.filter((o) => o.status === 'NOT_VERIFIABLE').length
    const unverifiableRate: TrackedMetric = {
      name: 'Unverifiable Rate',
      value: totalTrackedOutcomes > 0 ? (unverifiableCount / totalTrackedOutcomes) * 100 : null,
      description:
        'Percent of outcomes that the verification system could not confirm as successful (NOT_VERIFIABLE). Not a false-positive claim.',
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

    // 5. Measured PM decision latency (observed ONLY from the H7
    //    PMDecisionTelemetry stream — NEVER from rec.createdAt ->
    //    action.updatedAt, which conflates generation with approval).
    //    Latency per record = decisionCompletedAt - decisionStartedAt on the
    //    SAME client clock, so clock skew cancels out. With zero records the
    //    metric stays `unavailable`; it is never estimated.
    const latenciesMs = telemetry
      .map((t) => t.decisionCompletedAt.getTime() - t.decisionStartedAt.getTime())
      .filter((ms) => ms >= 0)
    const latencyCount = latenciesMs.length
    const measuredDecisionLatencySeconds: TrackedMetric = {
      name: 'Measured PM Decision Latency',
      value:
        latencyCount > 0
          ? Math.round((latenciesMs.reduce((a, b) => a + b, 0) / latencyCount / 1000) * 10) / 10
          : null,
      description:
        latencyCount > 0
          ? `Mean PM decision window across ${latencyCount} recorded decision(s): decisionCompletedAt - decisionStartedAt (client-clock delta, skew-cancelling).`
          : 'Real PM decision latency requires the H7 PMDecisionTelemetry stream (decisionStartedAt → decisionCompletedAt). No values are presented until that stream records decisions.',
      source: 'empirical_observation',
      calculation: 'mean(decisionCompletedAt - decisionStartedAt) over recorded decisions',
      observationCount: latencyCount,
      confidence:
        latencyCount === 0
          ? 'insufficient_data'
          : latencyCount < 5
            ? 'insufficient_data'
            : latencyCount < 20
              ? 'low'
              : 'medium',
      epistemicState: latencyCount > 0 ? 'observed' : 'unavailable',
    }

    // Separate observation populations for H7 measurement integrity.
    // The confidence classification for PM decision telemetry uses
    // decisionCount ONLY — not the combined recommendation+outcome+action
    // count, because those are different observational populations.

    // H7 Confidence: the classification for PM decision telemetry MUST use
    // decisionCount ONLY (real PM decisions from the telemetry stream).
    const confidenceBucket =
      decisionCount === 0 ? DEFAULT_TELEMETRY_BUCKET : bucketFor(decisionCount)

    return {
      workspaceId,
      projectId,
      generatedAt: new Date(),
      observationCount: decisionCount,
      // PM Decision Metrics (telemetry population only)
      decisionAcceptanceRate,
      decisionRejectionRate,
      decisionDeferRate,
      decisionOverrideRate,
      meanPriorityOverrideDelta,
      measuredDecisionLatencySeconds,
      // Outcome Metrics (outcome population only)
      outcomeSuccessRate,
      unverifiableRate,
      // Execution Metrics (action population only)
      executionSuccessRate,
      confidence: {
        bucket: confidenceBucket,
        rationale: bucketRationale(confidenceBucket),
      },
    }
  }
}
