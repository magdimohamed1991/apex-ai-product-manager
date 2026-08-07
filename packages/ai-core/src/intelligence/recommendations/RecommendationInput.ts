import type { Insight, Finding, WorkspaceId } from '../../domain'

export interface RecommendationInput {
  workspaceId: WorkspaceId
  insight?: Insight
  finding?: Finding
}
