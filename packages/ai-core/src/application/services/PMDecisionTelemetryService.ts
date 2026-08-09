import { createHash } from 'node:crypto'
import { Logger } from '../../observability/Logger'
import type { PMDecisionTelemetry, PMDecisionKind } from './ProductValidationService'
import type { WorkspaceId } from '../../domain/value-objects'

const log = new Logger('h7.telemetry')

/**
 * PMDecisionTelemetryService (Milestone I - Production Hardening)
 *
 * Captures REAL PM decisions on recommendations, including:
 *   - When the recommendation was presented
 *   - When the PM started their decision process
 *   - When the PM completed the decision
 *   - The actual decision (ACCEPT / REJECT / DEFER / OVERRIDE)
 *   - Original H3 baseline + H6 calibrated score
 *   - PM override value (numeric OR rank)
 *   - Override delta (|H6 - PM|) or rank displacement
 *
 * Storage: in-memory for the single-process architecture. Persist via
 * a real repository adapter when scaling out.
 *
 * Why this is real telemetry, not the legacy `recommendation.createdAt ->
 * action.updatedAt`:
 *   - The legacy measurement conflates recommendation generation with
 *     action approval (a different user action, possibly a different time).
 *   - The new model tracks the PM's explicit decision window on a single
 *     recommendation, with a typed decision kind.
 */
export interface RecordDecisionInput {
  workspaceId: string
  projectId: string
  recommendationId: string
  category?: string
  originalH3Score: number
  calibratedH6Score: number
  decision: PMDecisionKind
  decisionStartedAt: Date
  decisionCompletedAt: Date
  recommendationPresentedAt: Date
  pmSelectedPriority?: number
  apexRank?: number
  pmRank?: number
}

export class PMDecisionTelemetryService {
  private readonly decisions = new Map<string, PMDecisionTelemetry>()
  private readonly list: PMDecisionTelemetry[] = []

  recordDecision(input: RecordDecisionInput): PMDecisionTelemetry {
    const id = this.computeId(input)
    const existing = this.decisions.get(id)
    if (existing) return existing

    const overrideOccurred =
      input.pmSelectedPriority !== undefined
        ? Math.abs(input.calibratedH6Score - input.pmSelectedPriority) > 0.01
        : input.apexRank !== undefined && input.pmRank !== undefined
          ? Math.abs(input.apexRank - input.pmRank) > 0
          : false

    const overrideDelta =
      input.pmSelectedPriority !== undefined
        ? Math.abs(input.calibratedH6Score - input.pmSelectedPriority)
        : undefined

    const rankDisplacement =
      input.apexRank !== undefined && input.pmRank !== undefined
        ? Math.abs(input.apexRank - input.pmRank)
        : undefined

    const telemetry: PMDecisionTelemetry = {
      id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      recommendationId: input.recommendationId,
      category: input.category,
      recommendationPresentedAt: input.recommendationPresentedAt,
      decisionStartedAt: input.decisionStartedAt,
      decisionCompletedAt: input.decisionCompletedAt,
      decision: input.decision,
      pmSelectedPriority: input.pmSelectedPriority,
      calibratedH6Score: input.calibratedH6Score,
      originalH3Score: input.originalH3Score,
      overrideOccurred,
      overrideDelta,
      rankDisplacement,
      recordedAt: new Date(),
    }
    this.decisions.set(id, telemetry)
    this.list.push(telemetry)
    log.info('PM decision recorded', {
      workspaceId: input.workspaceId,
      recommendationId: input.recommendationId,
      decision: input.decision,
      overrideOccurred,
    })
    return telemetry
  }

  listForProject(workspaceId: WorkspaceId, projectId: string): PMDecisionTelemetry[] {
    return this.list.filter((t) => t.workspaceId === workspaceId && t.projectId === projectId)
  }

  /**
   * Compute the measured PM decision latency (seconds) for a project.
   * Returns null when no decisions are recorded.
   */
  measuredDecisionLatency(workspaceId: WorkspaceId, projectId: string): number | null {
    const list = this.listForProject(workspaceId, projectId)
    if (list.length === 0) return null
    const totalMs = list.reduce(
      (sum, t) => sum + (t.decisionCompletedAt.getTime() - t.decisionStartedAt.getTime()),
      0
    )
    return totalMs / list.length / 1000
  }

  overrideRate(workspaceId: WorkspaceId, projectId: string): number | null {
    const list = this.listForProject(workspaceId, projectId)
    if (list.length === 0) return null
    const overrides = list.filter((t) => t.overrideOccurred).length
    return overrides / list.length
  }

  private computeId(input: RecordDecisionInput): string {
    const h = createHash('sha256')
      .update(
        `${input.workspaceId}|${input.recommendationId}|${input.decisionStartedAt.toISOString()}`
      )
      .digest('hex')
    return `pmd-${h.slice(0, 24)}`
  }
}

/** Module-scoped default for the single-process server. */
export const globalPMDecisionTelemetry = new PMDecisionTelemetryService()
