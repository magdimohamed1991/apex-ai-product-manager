import type { WorkspaceId } from '../value-objects'
import type { RecommendationOutcome } from '../entities/RecommendationOutcome'

export interface RecommendationOutcomeRepository {
  getByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<RecommendationOutcome | null>
  getByIdWorkspaceAndProject(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<RecommendationOutcome | null>
  getByRecommendation(
    recId: string,
    workspaceId: WorkspaceId
  ): Promise<RecommendationOutcome | null>
  getByProject(projectId: string, workspaceId: WorkspaceId): Promise<RecommendationOutcome[]>
  save(outcome: RecommendationOutcome): Promise<void>
}
