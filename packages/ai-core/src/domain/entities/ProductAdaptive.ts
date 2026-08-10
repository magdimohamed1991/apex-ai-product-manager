import type { WorkspaceId } from '../value-objects'

/**
 * Epistemic state of a LearningSignal (Milestone I - Production Hardening)
 *
 *   - 'observed'           : the underlying decision/outcome data is real
 *                            and the observation count is above the minimum
 *                            threshold.
 *   - 'estimated'          : the data is real but the observation count
 *                            is too small to draw a strong conclusion.
 *                            Coefficients are still computed for transparency
 *                            but must be treated as low-confidence.
 *   - 'insufficient_evidence' : we cannot reliably say anything. The
 *                            category MUST NOT influence the calibrator.
 */
export type SignalEvidenceState = 'observed' | 'estimated' | 'insufficient_evidence'

export interface LearningSignal {
  id: string
  workspaceId: WorkspaceId
  projectId: string

  category: string
  type:
    | 'ADOPTION'
    | 'ACCEPTANCE'
    | 'EXECUTION_SUCCESS'
    | 'OUTCOME_SUCCESS'
    | 'REJECTION'
    | 'IGNORED'
    | 'CALIBRATION'
    | 'DEFER'
    | 'OVERRIDE'
    | 'DECISION_LATENCY'
    | 'PRIORITY_OVERRIDE_DELTA'

  observationCount: number
  value: number // Rate or multiplier value, e.g. 0.85
  confidence: number // Statistical confidence weight from 0.0 to 1.0

  sourceRecommendationIds: string[]
  /**
   * The COMPLETE denominator population used to calculate this signal's
   * value. For a telemetry-derived RATE signal (ACCEPTANCE / REJECTION /
   * DEFER / OVERRIDE) this is every PMDecisionTelemetry record in the
   * project+category decision population (e.g. ALL_DECISIONS), so an
   * auditor can reconstruct `value = numerator / |sourceTelemetryIds|`.
   * For DECISION_LATENCY / PRIORITY_OVERRIDE_DELTA the denominator is the
   * exact record set the statistic was computed over. Present for
   * telemetry-derived signals; absent for action/outcome-derived signals
   * (ADOPTION, EXECUTION_SUCCESS, OUTCOME_SUCCESS). Every id here is a
   * real persisted `PMDecisionTelemetry.id` — no opaque signal may
   * influence H6.
   */
  sourceTelemetryIds?: string[]
  /**
   * The records contributing to the NUMERATOR of a telemetry-derived rate
   * signal (e.g. the ACCEPT records within the ACCEPTANCE denominator).
   * Together with `sourceTelemetryIds` (the denominator) this lets an
   * auditor fully reconstruct `value = numerator.length / denominator.length`
   * from persisted telemetry alone. For statistics where the numerator is
   * the entire population (DECISION_LATENCY, PRIORITY_OVERRIDE_DELTA) this
   * equals `sourceTelemetryIds`. Absent for non-telemetry signals.
   */
  numeratorTelemetryIds?: string[]
  /**
   * Signed mean of (pmSelectedPriority - calibratedH6Score) over the exact
   * OVERRIDE telemetry records in `sourceTelemetryIds`. Kept separate from
   * `value` (which is the mean of |overrideDelta|, i.e. magnitude) so the
   * calibrator can distinguish the DIRECTION of systematic corrections
   * without losing the auditable magnitude. Optional — present only when
   * override telemetry with a numeric pmSelectedPriority exists.
   */
  meanSignedOverrideDelta?: number
  generatedAt: Date

  evidenceState?: SignalEvidenceState
  /**
   * Version of the calibration algorithm that produced this signal.
   * Together with `evidenceState` and `sourceRecommendationIds` this
   * makes the signal fully reproducible from the source observations.
   */
  calibrationVersion?: string
}

export interface CategoryCoefficient {
  category: string
  adoptionRate: number
  executionSuccessRate: number
  outcomeVerifiedRate: number
  pmCalibrationWeight: number
  /**
   * Number of REAL outcome observations (RecommendationOutcome rows) for
   * this category. `outcomeVerifiedRate` alone is ambiguous: a 0 value can
   * mean "0 verified of N observed" (genuine negative evidence) or "0
   * observations" (no evidence at all). The calibrator uses this count to
   * gate the outcome multiplier so ZERO observations stay neutral while an
   * OBSERVED zero rate remains real negative evidence. Optional so legacy /
   * hand-built profiles (without the count) default to neutral (no outcome
   * influence).
   */
  outcomeObservationCount?: number
}

export interface AdaptiveLearningProfile {
  workspaceId: WorkspaceId
  projectId: string
  totalDecisionsObserved: number
  lastCalculatedAt: Date

  PMPreferences: {
    favoredCategories: string[]
    ignoredCategories: string[]
  }

  categoryCoefficients: CategoryCoefficient[]

  biasAdjustments: {
    overPrioritizedLowEffort: boolean
    favoredHighImpact: boolean
  }

  /**
   * Version of the calibration algorithm that produced this profile.
   * Stored so historical scores remain reproducible even if future H6
   * formulas change.
   */
  calibrationVersion?: string
}

export interface PriorityCalibration {
  baseScore: number
  calibratedScore: number

  preferenceMultiplier: number
  outcomeReliabilityMultiplier: number

  appliedSignals: LearningSignal[]

  explanation: string

  /**
   * If true, the calibrated score was preserved at the safety floor
   * (critical >= 8.5, high >= 7.0) because a calibration multiplier would
   * otherwise have deflated it below the floor.
   */
  safetyFloorEnforced?: boolean
  calibrationVersion?: string
}

export interface VerificationEvidence {
  hasVitestConfig?: boolean
  hasJestConfig?: boolean
  hasJest?: boolean
  hasGitHubActions?: boolean
  hasCI?: boolean
  hasTypeScriptConfig?: boolean
  // Open-ended by design: callers (including the API boundary) may supply
  // additional filesystem signals; strategies only consult the typed keys.
  [key: string]: unknown
}
