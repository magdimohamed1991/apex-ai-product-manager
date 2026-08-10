import type { WorkspaceId } from '../value-objects'
import type {
  Workspace,
  Project,
  RepositoryConnection,
  PipelineRun,
  Finding,
  Recommendation,
  AIProductReasoning,
  PMDecisionTelemetry,
} from '../entities'

export interface ProductRepository {
  // Workspace operations
  getWorkspaceById(id: WorkspaceId): Promise<Workspace | null>
  getAllWorkspaces(): Promise<Workspace[]>
  saveWorkspace(workspace: Workspace): Promise<void>

  // Project operations
  getProjectByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<Project | null>
  getProjectsByWorkspace(workspaceId: WorkspaceId): Promise<Project[]>
  saveProject(project: Project): Promise<void>

  // Repository Connection operations
  getRepositoryConnectionByIdAndWorkspace(
    id: string,
    workspaceId: WorkspaceId
  ): Promise<RepositoryConnection | null>
  getRepositoryConnectionByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<RepositoryConnection | null>
  saveRepositoryConnection(conn: RepositoryConnection): Promise<void>

  // Pipeline Run operations
  getPipelineRunByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<PipelineRun | null>
  getPipelineRunsByProject(projectId: string, workspaceId: WorkspaceId): Promise<PipelineRun[]>
  savePipelineRun(run: PipelineRun): Promise<void>

  // Finding operations
  getFindingsByProject(projectId: string, workspaceId: WorkspaceId): Promise<Finding[]>
  saveFinding(finding: Finding, projectId: string): Promise<void>
  deleteFindingsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void>

  // Recommendation operations
  getRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<Recommendation[]>
  getRecommendationByIdAndWorkspace(
    id: string,
    workspaceId: WorkspaceId
  ): Promise<Recommendation | null>
  /** Project-owned recommendation lookup. Use at authorization boundaries. */
  getRecommendationByIdWorkspaceAndProject(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<Recommendation | null>
  saveRecommendation(rec: Recommendation, projectId: string): Promise<void>
  deleteRecommendationsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void>

  // AI Product Reasoning operations
  getAIProductReasoning(
    recommendationId: string,
    workspaceId: WorkspaceId
  ): Promise<AIProductReasoning | null>
  saveAIProductReasoning(reasoning: AIProductReasoning): Promise<void>

  // H7 PM decision telemetry operations (persisted, workspace-scoped)
  savePMDecisionTelemetry(telemetry: PMDecisionTelemetry): Promise<void>
  getPMDecisionTelemetryByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<PMDecisionTelemetry[]>
}
