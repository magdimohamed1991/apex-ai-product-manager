import type { WorkspaceId, Priority, Severity } from '../value-objects'
import type { Insight } from './Insight'

/**
 * A Finding is an actionable problem or opportunity synthesized from
 * cross-source Evidence correlation via the CorrelationEngine.
 *
 * Current origin path (the only implemented path):
 *   Evidence → Correlation → Finding → Recommendation → Action
 *
 * Findings always have `correlationId` set. The `relatedInsights` field
 * is reserved for a future path (Insight → Finding) but is not currently
 * populated by any pipeline stage. Insights currently generate Recommendations
 * directly without an intermediate Finding.
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
  relatedInsights: Insight['id'][] // reserved — not populated by current pipeline
  evidenceIds: string[] // direct evidence provenance
  correlationId?: string // set when Finding originates from Correlation Engine
  createdAt: Date
}
