import type { WorkspaceId } from '../value-objects'

/**
 * An Explanation describes WHY an Insight was generated.
 * It links back to raw Evidence and the Rules that matched.
 *
 * This enables the "Why?" button in the UI —
 * the user can always trace an AI recommendation back to ground truth.
 */
export interface Explanation {
  id: string
  workspaceId: WorkspaceId
  insightId: string
  summary: string
  evidence: string[] // evidence ids or human-readable descriptions
  appliedRules: string[] // rule ids
  confidenceReason: string
  createdAt: Date
}
