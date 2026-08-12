/**
 * UXRepository — domain repository contract for H10.
 */
import type { WorkspaceId } from '../value-objects'
import type {
  UserJourney,
  FrictionPoint,
  UXAnalysis,
  UXRecommendation,
} from '../entities/UXIntelligence'

export interface UXRepository {
  saveUserJourney(journey: UserJourney): Promise<void>
  getUserJourneyById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<UserJourney | null>
  getUserJourneysByProject(projectId: string, workspaceId: WorkspaceId): Promise<UserJourney[]>
  deleteUserJourneysByProject(projectId: string, workspaceId: WorkspaceId): Promise<void>

  saveFrictionPoint(fp: FrictionPoint): Promise<void>
  getFrictionPointsByProject(projectId: string, workspaceId: WorkspaceId): Promise<FrictionPoint[]>
  deleteFrictionPointsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void>

  saveUXAnalysis(analysis: UXAnalysis): Promise<void>
  getUXAnalysisByProject(projectId: string, workspaceId: WorkspaceId): Promise<UXAnalysis | null>

  saveUXRecommendation(rec: UXRecommendation): Promise<void>
  getUXRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<UXRecommendation[]>
  deleteUXRecommendationsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void>
}
