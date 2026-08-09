import type { RichRecommendation } from '../../domain/entities'
import type {
  AdaptiveLearningProfile,
  PriorityCalibration,
  LearningSignal,
} from '../../domain/entities/ProductAdaptive'
import { Logger } from '../../observability/Logger'
import { ValidationError } from '../../errors/AppError'

const log = new Logger('h6.calibrator')

/**
 * Objective-risk safety floors. These are HARD invariants that must never
 * be relaxed by H6, regardless of historical PM preferences.
 *
 * A PM who historically ignored testing recommendations must NOT cause
 * APEX to deflate the priority of a genuinely critical production risk.
 */
export const SAFETY_FLOOR_CRITICAL = 8.5
export const SAFETY_FLOOR_HIGH = 7.0

const CALIBRATION_VERSION = 'h6-v1'

/**
 * H6 Prioritization Calibrator (Milestone H6)
 *
 * Calibrates canonical H3 baseline scores based on PM preference and
 * outcome reliability, strictly keeping the H3 baseline immutable and
 * preserving critical objective safety risks.
 *
 * Hardening contract (Milestone I - Production Hardening):
 *   1. H3 baseline score is preserved verbatim in `baseScore`.
 *   2. Calibration is applied multiplicatively but bounded by safety floors.
 *   3. Categories with `insufficient_evidence` MUST NOT influence calibration.
 *   4. The calibration algorithm version is recorded so historical
 *      decisions remain reproducible even if future formulas change.
 */
export class H6PrioritizationCalibrator {
  calibrate(
    recommendation: RichRecommendation,
    profile: AdaptiveLearningProfile | null,
    signals: LearningSignal[]
  ): PriorityCalibration {
    // Epistemic integrity: the H3 base score is a REAL number computed by
    // the deterministic scoring engine and persisted with the
    // recommendation. If it is missing or invalid, we must NOT fabricate a
    // baseline (the legacy `|| 5.0` silently invented a score whenever the
    // field was falsy). Fail loudly so callers surface the data anomaly.
    const rawScore = recommendation.priorityScore
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore <= 0) {
      throw new ValidationError(
        'Recommendation lacks a valid deterministic H3 priorityScore; cannot calibrate (no fabricated baseline).'
      )
    }
    const baseScore = rawScore
    const category = (recommendation as RichRecommendation & { category?: string }).category ?? null

    if (!profile || !category) {
      return {
        baseScore,
        calibratedScore: baseScore,
        preferenceMultiplier: 1.0,
        outcomeReliabilityMultiplier: 1.0,
        appliedSignals: [],
        explanation: category
          ? 'No adaptive learning profile is currently compiled for this project scope. Using baseline H3 score.'
          : 'Recommendation has no typed category. Using baseline H3 score (H6 cannot calibrate without typed category metadata).',
        safetyFloorEnforced: false,
        calibrationVersion: CALIBRATION_VERSION,
      }
    }

    const coef = profile.categoryCoefficients.find((c) => c.category === category)
    if (!coef) {
      return {
        baseScore,
        calibratedScore: baseScore,
        preferenceMultiplier: 1.0,
        outcomeReliabilityMultiplier: 1.0,
        appliedSignals: [],
        explanation: `Category "${category}" has no compiled coefficient. Using baseline H3 score.`,
        safetyFloorEnforced: false,
        calibrationVersion: CALIBRATION_VERSION,
      }
    }

    // Check if any signal in this category has insufficient evidence.
    // If so, we MUST NOT inflate the multiplier. We dampen to 1.0.
    const catSignals = signals.filter((s) => s.category === category)

    // ZERO compiled signals for the category: there is no empirical evidence
    // at all (e.g. 0 observations, or a category whose history disappeared).
    // Applying the coefficient (which is still computed for transparency)
    // would let an empty history deflate a critical score (e.g. the 0.9
    // outcome-reliability term alone turns a 9.5 into 8.6). No evidence
    // must mean no influence.
    if (catSignals.length === 0) {
      return {
        baseScore,
        calibratedScore: baseScore,
        preferenceMultiplier: 1.0,
        outcomeReliabilityMultiplier: 1.0,
        appliedSignals: [],
        explanation: `Category "${category}" has no compiled learning signals. H6 will not influence the baseline H3 score.`,
        safetyFloorEnforced: false,
        calibrationVersion: CALIBRATION_VERSION,
      }
    }

    const hasInsufficientEvidence = catSignals.some(
      (s) => s.evidenceState === 'insufficient_evidence'
    )
    if (hasInsufficientEvidence) {
      log.info('Calibration dampened due to insufficient_evidence signal', { category })
      return {
        baseScore,
        calibratedScore: baseScore,
        preferenceMultiplier: 1.0,
        outcomeReliabilityMultiplier: 1.0,
        appliedSignals: catSignals,
        explanation: `Category "${category}" has insufficient empirical evidence (< ${5} observations). H6 will not influence the baseline H3 score.`,
        safetyFloorEnforced: false,
        calibrationVersion: CALIBRATION_VERSION,
      }
    }

    const preferenceMultiplier = coef.pmCalibrationWeight
    const outcomeVerifiedRate = coef.outcomeVerifiedRate
    // Outcome success multiplier: bounded 0.9 to 1.1
    const outcomeReliabilityMultiplier = 1.0 + (outcomeVerifiedRate - 0.5) * 0.2

    let calibratedScore = baseScore * preferenceMultiplier * outcomeReliabilityMultiplier
    let safetyFloorEnforced = false

    // Enforce Invariant: preserve objective risk
    if (recommendation.priority === 'critical' && calibratedScore < SAFETY_FLOOR_CRITICAL) {
      calibratedScore = SAFETY_FLOOR_CRITICAL
      safetyFloorEnforced = true
    } else if (recommendation.priority === 'high' && calibratedScore < SAFETY_FLOOR_HIGH) {
      calibratedScore = SAFETY_FLOOR_HIGH
      safetyFloorEnforced = true
    }

    // Clamp to [0, 10]
    calibratedScore = Math.max(0, Math.min(10, Math.round(calibratedScore * 10) / 10))

    const explanation = `APEX adjusted the priority score from baseline ${baseScore} to ${calibratedScore} using empirical signals (adoption weight: ${preferenceMultiplier.toFixed(2)}, outcome verification weight: ${outcomeReliabilityMultiplier.toFixed(2)}, calibration version: ${CALIBRATION_VERSION}).${
      safetyFloorEnforced
        ? ` Safety floor was explicitly enforced to preserve ${recommendation.priority === 'critical' ? 'critical' : 'high'} objective risk.`
        : ''
    }`

    return {
      baseScore,
      calibratedScore,
      preferenceMultiplier,
      outcomeReliabilityMultiplier,
      appliedSignals: catSignals,
      explanation,
      safetyFloorEnforced,
      calibrationVersion: CALIBRATION_VERSION,
    }
  }
}
