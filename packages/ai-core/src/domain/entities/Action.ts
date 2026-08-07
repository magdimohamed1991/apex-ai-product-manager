import type { WorkspaceId, TaskStatus } from '../value-objects'
import type { Recommendation } from './Recommendation'

export type ActionTarget = 'jira' | 'linear' | 'github' | 'internal' | 'slack'

/**
 * An Action is an internal recommendation that can be exported
 * to an external tool (Jira, Linear, GitHub) or kept as internal.
 *
 * Action is different from a Task — a Task lives in an external tool.
 */
export interface Action {
  id: string
  workspaceId: WorkspaceId
  title: string
  description: string
  target: ActionTarget
  status: TaskStatus
  relatedRecommendation: Recommendation['id'] | null
  externalId: string | null // ID in Jira / Linear / GitHub after export
  createdAt: Date
  updatedAt: Date
}
