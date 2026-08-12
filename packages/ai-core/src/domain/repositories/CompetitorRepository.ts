/**
 * CompetitorRepository — domain repository contract for H9.
 */
import type { WorkspaceId } from '../value-objects'
import type {
  Competitor,
  CompetitorAnalysis,
  FeatureMatrix,
  PositioningMatrix,
  DifferentiationAnalysis,
  MarketOpportunity,
  CompetitorRecommendation,
} from '../entities/CompetitorIntelligence'

export interface CompetitorRepository {
  // Competitor CRUD
  saveCompetitor(competitor: Competitor): Promise<void>
  getCompetitorById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<Competitor | null>
  getCompetitorsByProject(projectId: string, workspaceId: WorkspaceId): Promise<Competitor[]>
  deleteCompetitorsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void>

  // Analysis aggregate
  saveAnalysis(analysis: CompetitorAnalysis): Promise<void>
  getAnalysisByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<CompetitorAnalysis | null>

  // Feature matrix
  saveFeatureMatrix(matrix: FeatureMatrix): Promise<void>
  getFeatureMatrix(projectId: string, workspaceId: WorkspaceId): Promise<FeatureMatrix | null>

  // Positioning matrix
  savePositioningMatrix(matrix: PositioningMatrix): Promise<void>
  getPositioningMatrix(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<PositioningMatrix | null>

  // Differentiation analysis
  saveDifferentiationAnalysis(analysis: DifferentiationAnalysis): Promise<void>
  getDifferentiationAnalysis(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<DifferentiationAnalysis | null>

  // Market opportunities
  saveMarketOpportunity(opp: MarketOpportunity): Promise<void>
  getMarketOpportunitiesByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<MarketOpportunity[]>

  // Competitor recommendations
  saveCompetitorRecommendation(rec: CompetitorRecommendation): Promise<void>
  getCompetitorRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<CompetitorRecommendation[]>
  deleteCompetitorRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<void>
}
