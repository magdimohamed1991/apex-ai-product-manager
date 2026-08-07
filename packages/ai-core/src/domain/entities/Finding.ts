import type { WorkspaceId, Priority, Severity } from '../value-objects'
import type { Insight } from './Insight'

/**
 * A Finding is an actionable problem or opportunity derived from one or more Insights.
 *
 * Insight (observation) → Finding (actionable signal) → Recommendation → Action
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
  correlationId?: string // set when Finding originates from Correlation Engine
  createdAt: Date
}
