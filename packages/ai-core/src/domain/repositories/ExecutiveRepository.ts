/**
 * ExecutiveRepository — domain repository contract for H12.
 */
import type { WorkspaceId } from '../value-objects'
import type {
  ExecutiveDashboard,
  ExecutiveReport,
  ProductHealthSnapshot,
  TrendDetection,
} from '../entities/ExecutiveIntelligence'

export interface ExecutiveRepository {
  saveExecutiveDashboard(dashboard: ExecutiveDashboard): Promise<void>
  getExecutiveDashboardByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ExecutiveDashboard | null>

  saveExecutiveReport(report: ExecutiveReport): Promise<void>
  getExecutiveReportById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ExecutiveReport | null>
  getExecutiveReportsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ExecutiveReport[]>

  saveProductHealthSnapshot(snapshot: ProductHealthSnapshot): Promise<void>
  getLatestProductHealthSnapshot(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ProductHealthSnapshot | null>
  getProductHealthSnapshotsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ProductHealthSnapshot[]>

  saveTrendDetection(trend: TrendDetection): Promise<void>
  getTrendDetectionsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<TrendDetection[]>
  deleteTrendDetectionsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void>
}
