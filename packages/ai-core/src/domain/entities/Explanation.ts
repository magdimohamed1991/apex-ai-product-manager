import type { WorkspaceId } from '../value-objects'

/**
 * An Explanation describes WHY an Insight or Finding was generated.
 * It links back to raw Evidence IDs and the Rules that matched.
 *
 * The UI fetches Evidence by ID to display the "Why?" details.
 * We store IDs here — not descriptions — to keep provenance traceable.
 */
export interface Explanation {
  id: string
  workspaceId: WorkspaceId
  insightIds: string[] // IDs of Insights this explanation covers
  findingIds: string[] // IDs of Findings this explanation covers
  summary: string
  evidenceIds: string[] // IDs into the Evidence store — never descriptions
  appliedRules: string[] // rule ids
  confidenceReason: string
  createdAt: Date
}
