import type { WorkspaceId, Priority, Severity } from '../value-objects'

/**
 * A Finding is an actionable problem or opportunity synthesized from
 * cross-source Evidence correlation via the CorrelationEngine.
 *
 * Current origin path (the only implemented path):
 *   Evidence → Correlation → Finding → Recommendation → Action
 *
 * Findings always have `correlationId` set. Insights currently generate
 * Recommendations directly without an intermediate Finding.
 *
 * Architecture decision: Findings are a correlation-layer concept.
 * For insight-derived signals, use Recommendation directly.
 */
export type FindingType = 'bug' | 'opportunity' | 'risk' | 'growth'

export interface Finding {
  id: string
  workspaceId: WorkspaceId
  type: FindingType
  title: string
  description: string
  priority: Priority
  severity: Severity
  evidenceIds: string[] // direct evidence provenance
  correlationId: string // always set — Findings are a correlation-layer concept
  createdAt: Date
}

/**
 * Domain factory to safely construct a correlation-derived Finding and enforce invariants.
 */
export function createCorrelationFinding(
  data: Omit<Finding, 'id' | 'createdAt'> & { id?: string; createdAt?: Date }
): Finding {
  if (!data.correlationId) {
    throw new Error('Correlation finding must have a correlationId')
  }
  if (!data.evidenceIds || data.evidenceIds.length === 0) {
    throw new Error('Correlation finding must have at least one evidenceId')
  }
  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    type: data.type,
    title: data.title,
    description: data.description,
    priority: data.priority,
    severity: data.severity,
    evidenceIds: data.evidenceIds,
    correlationId: data.correlationId,
    createdAt: data.createdAt ?? new Date(),
  }
}
