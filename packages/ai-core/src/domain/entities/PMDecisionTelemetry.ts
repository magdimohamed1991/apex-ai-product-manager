/**
 * PMDecisionTelemetry (Milestone H7 — Measurement Instrumentation)
 *
 * A REAL, persisted record of a PM's decision on a recommendation:
 *   - When the recommendation was presented to the PM
 *   - When the PM started their decision process
 *   - When the PM completed the decision
 *   - The actual decision kind (ACCEPT / REJECT / DEFER / OVERRIDE)
 *   - Original H3 baseline + H6 calibrated score at decision time
 *   - PM override value (numeric OR rank) and the resulting deltas
 *
 * Epistemic contract: every timestamp is a real user-action timestamp.
 * Decision latency is computed as (decisionCompletedAt - decisionStartedAt)
 * from the SAME clock (the client), so clock skew cancels out. The metric
 * derived from these records is only ever labeled `observed` when at least
 * one record exists; otherwise the H7 metric stays `unavailable`.
 */
import type { WorkspaceId } from '../value-objects'

export type PMDecisionKind = 'ACCEPT' | 'REJECT' | 'DEFER' | 'OVERRIDE'

export interface PMDecisionTelemetry {
  id: string
  workspaceId: WorkspaceId
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

/**
 * Validates the invariants of a telemetry record BEFORE persistence.
 * Throws a domain Error on any violation.
 */
export function validatePMDecisionTelemetry(telemetry: PMDecisionTelemetry): void {
  if (!telemetry.id || telemetry.id.trim().length === 0) {
    throw new Error('PMDecisionTelemetry must have a valid non-empty id')
  }
  if (!telemetry.workspaceId || telemetry.workspaceId.trim().length === 0) {
    throw new Error('PMDecisionTelemetry must have a valid non-empty workspaceId')
  }
  if (!telemetry.projectId || telemetry.projectId.trim().length === 0) {
    throw new Error('PMDecisionTelemetry must have a valid non-empty projectId')
  }
  if (!telemetry.recommendationId || telemetry.recommendationId.trim().length === 0) {
    throw new Error('PMDecisionTelemetry must reference a recommendationId')
  }
  const validKinds: PMDecisionKind[] = ['ACCEPT', 'REJECT', 'DEFER', 'OVERRIDE']
  if (!validKinds.includes(telemetry.decision)) {
    throw new Error(`PMDecisionTelemetry decision must be one of ${validKinds.join('|')}`)
  }
  if (
    !(telemetry.decisionStartedAt instanceof Date) ||
    Number.isNaN(telemetry.decisionStartedAt.getTime())
  ) {
    throw new Error('PMDecisionTelemetry decisionStartedAt must be a valid Date')
  }
  if (
    !(telemetry.decisionCompletedAt instanceof Date) ||
    Number.isNaN(telemetry.decisionCompletedAt.getTime())
  ) {
    throw new Error('PMDecisionTelemetry decisionCompletedAt must be a valid Date')
  }
  if (telemetry.decisionCompletedAt.getTime() < telemetry.decisionStartedAt.getTime()) {
    throw new Error('PMDecisionTelemetry decisionCompletedAt must not precede decisionStartedAt')
  }
  if (
    !(telemetry.recommendationPresentedAt instanceof Date) ||
    Number.isNaN(telemetry.recommendationPresentedAt.getTime())
  ) {
    throw new Error('PMDecisionTelemetry recommendationPresentedAt must be a valid Date')
  }
  // H7 telemetry-window invariant (strict domain validation, never repaired):
  //   recommendationPresentedAt <= decisionStartedAt <= decisionCompletedAt
  // A recommendation cannot be decided before it was presented, and a
  // decision cannot complete before it started. Violations are REJECTED,
  // not silently clamped — measurement integrity requires the raw window.
  if (telemetry.recommendationPresentedAt.getTime() > telemetry.decisionStartedAt.getTime()) {
    throw new Error(
      'PMDecisionTelemetry recommendationPresentedAt must not follow decisionStartedAt (presentation must precede the decision window)'
    )
  }
  if (
    typeof telemetry.originalH3Score !== 'number' ||
    !Number.isFinite(telemetry.originalH3Score)
  ) {
    throw new Error('PMDecisionTelemetry originalH3Score must be a finite number')
  }
  if (
    typeof telemetry.calibratedH6Score !== 'number' ||
    !Number.isFinite(telemetry.calibratedH6Score)
  ) {
    throw new Error('PMDecisionTelemetry calibratedH6Score must be a finite number')
  }
  if (telemetry.overrideOccurred !== true && telemetry.overrideOccurred !== false) {
    throw new Error('PMDecisionTelemetry overrideOccurred must be a boolean')
  }
}
