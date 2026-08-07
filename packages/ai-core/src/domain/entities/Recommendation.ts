import type { WorkspaceId, Priority } from '../value-objects'

export type EffortLevel = 'low' | 'medium' | 'high'

export type RecommendationOrigin = 'insight' | 'finding'

export interface ProposedAction {
  title: string
  description: string
}

export interface Recommendation {
  id: string
  workspaceId: WorkspaceId
  origin: RecommendationOrigin
  deduplicationKey: string // strategy:origin:sourceEntityId — used to detect semantic duplicates
  title: string
  rationale: string
  impact: string
  effort: EffortLevel
  priority: Priority
  confidence: number // 0–1
  insightIds: string[]
  findingIds: string[]
  proposedActions: ProposedAction[]
  createdAt: Date
}
