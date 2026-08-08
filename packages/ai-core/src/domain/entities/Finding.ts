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
  correlationId?: string // set when Finding originates from Correlation Engine
  createdAt: Date
}
