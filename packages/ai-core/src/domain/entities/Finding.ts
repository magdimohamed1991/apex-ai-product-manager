import type { WorkspaceId, Priority, Severity } from '../value-objects'
import type { Insight } from './Insight'

/**
 * A Finding is an actionable problem or opportunity synthesized from
 * either one or more Insights or from cross-source Evidence correlation.
 *
 * Origin paths:
 *   Insight (observation) → Finding (actionable signal) → Recommendation → Action
 *   Evidence → Correlation → Finding (actionable signal) → Recommendation → Action
 *
 * Findings originating from correlation will have `correlationId` set
 * and `relatedInsights` empty. Findings derived from Insights will
 * have `relatedInsights` populated and `correlationId` absent.
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
  relatedInsights: Insight['id'][]
  evidenceIds: string[] // direct evidence provenance
  correlationId?: string // set when Finding originates from Correlation Engine
  createdAt: Date
}
