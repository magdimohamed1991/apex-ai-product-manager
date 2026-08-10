import type { RichRecommendation } from '../../domain/entities'
import type {
  AdaptiveLearningProfile,
  PriorityCalibration,
  LearningSignal,
} from '../../domain/entities/ProductAdaptive'
import { Logger } from '../../observability/Logger'
import { ValidationError } from '../../errors/AppError'
import { CALIBRATION_VERSION } from './AdaptiveProfileCompiler'

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

/**
 * Bounds of the H7 telemetry-driven calibration adjustments (h6-v2).
 *
 * - H7_DECISION_ADJUSTMENT_MAX: maximum contribution of the telemetry
 *   decision valence (ACCEPT - REJECT rates) to the preference multiplier.
 * - H7_OVERRIDE_DELTA_ADJUSTMENT_MAX: maximum contribution of the mean
 *   SIGNED override delta (PM priority minus H6 score) to the multiplier.
 *
 * Both are dampened by the telemetry confidence (n / (n + 10)) so small
 * samples cannot swing the multiplier, and the combined multiplier is
 * hard-clamped to [MULTIPLIER_FLOOR, MULTIPLIER_CEIL] = [0.85, 1.15].
 */
export const H7_DECISION_ADJUSTMENT_MAX = 0.3
export const H7_OVERRIDE_DELTA_ADJUSTMENT_MAX = 0.1
export const MULTIPLIER_FLOOR = 0.85
export const MULTIPLIER_CEIL = 1.15

/**
 * H6 Prioritization Calibrator (Milestone H6, calibration contract h6-v2)
 *
 * Calibrates canonical H3 baseline scores based on PM preference and
 * outcome reliability, strictly keeping the H3 baseline immutable and
 * preserving critical objective safety risks.
 *
 * Calibration contract (h6-v2 — H7 telemetry-derived evidence):
 *   1. H3 baseline score is preserved verbatim in `baseScore`.
 *   2. Calibration is applied multiplicatively but bounded by safety floors.
 *   3. Categories with `insufficient_evidence` MUST NOT influence calibration.
 *   4. The calibration algorithm version is recorded so historical
 *      decisions remain reproducible even if future formulas change.
 *   5. H7 decision evidence (ACCEPTANCE / REJECTION / DEFER / OVERRIDE
 *      rates, PRIORITY_OVERRIDE_DELTA) is computed from the REAL
 *      PMDecisionTelemetry population and modifies the preference
 *      multiplier in a deterministic, bounded, explainable way:
 *        - valence = acceptRate - rejectRate  (telemetry population only)
 *        - ambiguity = 0.5 * overrideRate + 0.5 * clamp((meanAbsDelta-1)/4)
 *          (a high override rate / large deltas mean the PM disagrees with
 *          APEX's absolute priority scale, so acceptance can no longer be
 *          read as pure preference — the system must NOT blindly interpret
 *          high acceptance + high override as simple preference)
 *        - decisionAdjustment = valence * 0.3 * confidence * (1 - ambiguity)
 *        - overrideDeltaAdjustment = clamp(meanSignedDelta/5) * 0.1 *
 *          confidence  (direction-aware, distinguishes small consistent
 *          corrections from large systematic corrections)
 *        - preferenceMultiplier = clamp(pmCalibrationWeight +
 *          decisionAdjustment + overrideDeltaAdjustment, 0.85, 1.15)
 *   6. DECISION_LATENCY is OBSERVATIONAL ONLY. The calibration contract
 *      does NOT define "faster = better"; the signal is preserved as
 *      auditable evidence in `appliedSignals` and never modifies scores.
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

    // Epistemic gate (h6-v2): a signal marked `insufficient_evidence` must
    // not INFLUENCE calibration — but it must not veto other real evidence
    // either. The category calibrates only when at least one signal is
    // OBSERVED; insufficient signals are excluded from the formula (and
    // flagged in the explanation). This keeps the legacy guarantee
    // ("no observations → no influence") while allowing a 20-decision
    // telemetry population to calibrate even when one kind's count (e.g.
    // DEFER with 4 records) is below its own confidence threshold.
    const observedSignals = catSignals.filter((s) => s.evidenceState === 'observed')
    if (observedSignals.length === 0) {
      log.info('Calibration dampened: no observed signal for category', { category })
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

    // ------------------------------------------------------------------
    // H7 telemetry-derived calibration evidence (contract h6-v2).
    // Decision rates come ONLY from the PMDecisionTelemetry population:
    // ACCEPTANCE / REJECTION / DEFER / OVERRIDE signal values are real
    // rates over the persisted telemetry records. They are NOT inferred
    // from action status or recommendations. Insufficient signals are
    // excluded from the formula below.
    // ------------------------------------------------------------------
    const acceptanceSignal = observedSignals.find((s) => s.type === 'ACCEPTANCE')
    const rejectionSignal = observedSignals.find((s) => s.type === 'REJECTION')
    const overrideSignal = observedSignals.find((s) => s.type === 'OVERRIDE')
    const deltaSignal = catSignals.find((s) => s.type === 'PRIORITY_OVERRIDE_DELTA')
    const latencySignal = catSignals.find((s) => s.type === 'DECISION_LATENCY')
    const deferSignal = observedSignals.find((s) => s.type === 'DEFER')

    const decisionSignals = [acceptanceSignal, rejectionSignal, overrideSignal, deferSignal].filter(
      (s): s is LearningSignal => s !== undefined
    )

    const acceptRate = acceptanceSignal?.value ?? 0
    const rejectRate = rejectionSignal?.value ?? 0
    const overrideRate = overrideSignal?.value ?? 0
    const meanAbsOverrideDelta = deltaSignal?.value ?? 0

    const decisionObservationCount =
      decisionSignals.length > 0 ? Math.max(...decisionSignals.map((s) => s.observationCount)) : 0
    // Same bounded dampener as the compiler (n / (n + 10)): never a
    // statistical claim — just a deterministic small-sample dampener.
    const decisionConfidence =
      decisionObservationCount > 0 ? decisionObservationCount / (decisionObservationCount + 10) : 0

    // Valence: acceptance minus rejection over the telemetry population.
    // DEFER is neutral (postponed, not refused); OVERRIDE is handled by
    // the ambiguity + delta terms below.
    const valence = Math.max(-1, Math.min(1, acceptRate - rejectRate))

    // Ambiguity: when the PM overrides often and/or with large deltas,
    // acceptance can no longer be read as pure preference (contradictory
    // signals, Scenario G). Ranges [0, 1]; 1 = fully ambiguous.
    const deltaPenalty = Math.max(0, Math.min(1, (meanAbsOverrideDelta - 1) / 4))
    const ambiguity = Math.max(0, Math.min(1, 0.5 * overrideRate + 0.5 * deltaPenalty))

    const decisionAdjustment =
      valence * H7_DECISION_ADJUSTMENT_MAX * decisionConfidence * (1 - ambiguity)

    // Directional override-delta correction: only when signed deltas are
    // available (PM supplied a numeric priority). A large systematic push
    // (|signed| >= 5 points) yields at most ±0.1 * confidence; a 1-point
    // correction yields at most ±0.02 * confidence — small consistent
    // corrections are distinguishable from large systematic corrections,
    // and small samples cannot overreact (confidence dampening).
    let overrideDeltaAdjustment = 0
    if (
      deltaSignal &&
      deltaSignal.meanSignedOverrideDelta !== undefined &&
      deltaSignal.evidenceState === 'observed'
    ) {
      const normalizedSignedDelta = Math.max(
        -1,
        Math.min(1, deltaSignal.meanSignedOverrideDelta / 5)
      )
      overrideDeltaAdjustment =
        normalizedSignedDelta * H7_OVERRIDE_DELTA_ADJUSTMENT_MAX * decisionConfidence
    }

    // Combined preference multiplier: adoption weight (from the compiled
    // coefficient, [0.85, 1.15]) adjusted by the H7 telemetry evidence,
    // hard-clamped to the documented [0.85, 1.15] bounds.
    const preferenceMultiplier = Math.min(
      MULTIPLIER_CEIL,
      Math.max(
        MULTIPLIER_FLOOR,
        coef.pmCalibrationWeight + decisionAdjustment + overrideDeltaAdjustment
      )
    )
    const outcomeVerifiedRate = coef.outcomeVerifiedRate
    // Outcome success multiplier: bounded 0.9 to 1.1 (outcome population)
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

    // Deterministic, auditable explanation of every evidence component.
    const evidenceParts: string[] = []
    if (decisionObservationCount > 0) {
      const pct = (v: number) => `${Math.round(v * 100)}%`
      const rateParts: string[] = []
      if (acceptanceSignal) rateParts.push(`ACCEPT ${pct(acceptRate)}`)
      if (rejectionSignal) rateParts.push(`REJECT ${pct(rejectRate)}`)
      if (deferSignal) rateParts.push(`DEFER ${pct(deferSignal.value)}`)
      if (overrideSignal) rateParts.push(`OVERRIDE ${pct(overrideRate)}`)
      evidenceParts.push(
        `H7 decision evidence over ${decisionObservationCount} telemetry decision(s): ${rateParts.join(' / ')} → adjustment ${decisionAdjustment >= 0 ? '+' : ''}${decisionAdjustment.toFixed(3)}`
      )
    }
    // Flag signals that exist but were excluded from the formula because
    // their own observation count is below the confidence threshold.
    const excluded = catSignals
      .filter((s) => s.evidenceState === 'insufficient_evidence')
      .map((s) => s.type)
    if (excluded.length > 0) {
      evidenceParts.push(
        `${excluded.join(', ')} evidence insufficient (< 5 observations) — excluded from adjustment`
      )
    }
    if (deltaSignal && deltaSignal.evidenceState === 'observed') {
      evidenceParts.push(
        `mean override delta ${meanAbsOverrideDelta.toFixed(2)} (signed ${
          deltaSignal.meanSignedOverrideDelta !== undefined
            ? `${deltaSignal.meanSignedOverrideDelta >= 0 ? '+' : ''}${deltaSignal.meanSignedOverrideDelta.toFixed(2)}`
            : 'n/a'
        }) → adjustment ${overrideDeltaAdjustment >= 0 ? '+' : ''}${overrideDeltaAdjustment.toFixed(3)}`
      )
    }
    if (ambiguity > 0 && decisionSignals.length > 0) {
      evidenceParts.push(
        `override evidence treated as ambiguity (${Math.round(ambiguity * 100)}%), not simple preference`
      )
    }
    if (latencySignal) {
      evidenceParts.push(
        `decision latency ${latencySignal.value}s over ${latencySignal.observationCount} decision(s) recorded as observational evidence only (no quality interpretation)`
      )
    }

    const explanation = `APEX adjusted the priority score from baseline ${baseScore} to ${calibratedScore} using empirical signals (adoption weight: ${preferenceMultiplier.toFixed(2)}, outcome verification weight: ${outcomeReliabilityMultiplier.toFixed(2)}${
      evidenceParts.length > 0 ? `; ${evidenceParts.join('; ')}` : ''
    }; calibration version: ${CALIBRATION_VERSION}).${
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
