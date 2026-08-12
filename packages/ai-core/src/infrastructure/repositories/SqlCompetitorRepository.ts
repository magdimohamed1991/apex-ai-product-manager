/**
 * SqlCompetitorRepository — H9 persistence adapter.
 *
 * Implements the CompetitorRepository domain contract against the
 * DurableFileDatabase single-process store. All upserts are scoped by
 * (id, workspaceId, projectId) to preserve multi-tenant isolation.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { CompetitorRepository } from '../../domain/repositories/CompetitorRepository'
import type {
  Competitor,
  CompetitorAnalysis,
  FeatureMatrix,
  PositioningMatrix,
  DifferentiationAnalysis,
  MarketOpportunity,
  CompetitorRecommendation,
} from '../../domain/entities/CompetitorIntelligence'
import type { DurableFileDatabase } from '../database/DurableFileDatabase'

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export class SqlCompetitorRepository implements CompetitorRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  // --- Competitor ---

  async saveCompetitor(competitor: Competitor): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.competitors) state.competitors = []
      state.competitors = state.competitors.filter(
        (c) =>
          !(
            c.id === competitor.id &&
            c.workspaceId === competitor.workspaceId &&
            c.projectId === competitor.projectId
          )
      )
      state.competitors.push(deepClone(competitor))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getCompetitorById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<Competitor | null> {
    const state = this.db.getActiveState()
    const c = (state.competitors ?? []).find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return c ? deepClone(c) : null
  }

  async getCompetitorsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<Competitor[]> {
    const state = this.db.getActiveState()
    return (state.competitors ?? [])
      .filter((c) => c.projectId === projectId && c.workspaceId === workspaceId)
      .map(deepClone)
  }

  async deleteCompetitorsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.competitors) {
        state.competitors = state.competitors.filter(
          (c) => !(c.projectId === projectId && c.workspaceId === workspaceId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  // --- CompetitorAnalysis ---

  async saveAnalysis(analysis: CompetitorAnalysis): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.competitorAnalyses) state.competitorAnalyses = []
      state.competitorAnalyses = state.competitorAnalyses.filter(
        (a) =>
          !(
            a.id === analysis.id &&
            a.workspaceId === analysis.workspaceId &&
            a.projectId === analysis.projectId
          )
      )
      state.competitorAnalyses.push(deepClone(analysis))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getAnalysisByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<CompetitorAnalysis | null> {
    const state = this.db.getActiveState()
    const list = (state.competitorAnalyses ?? []).filter(
      (a) => a.projectId === projectId && a.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    // Return the most recently started analysis
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    return deepClone(sorted[0])
  }

  // --- FeatureMatrix ---

  async saveFeatureMatrix(matrix: FeatureMatrix): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.featureMatrices) state.featureMatrices = []
      state.featureMatrices = state.featureMatrices.filter(
        (m) =>
          !(
            m.id === matrix.id &&
            m.workspaceId === matrix.workspaceId &&
            m.projectId === matrix.projectId
          )
      )
      state.featureMatrices.push(deepClone(matrix))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getFeatureMatrix(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<FeatureMatrix | null> {
    const state = this.db.getActiveState()
    const list = (state.featureMatrices ?? []).filter(
      (m) => m.projectId === projectId && m.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    return deepClone(sorted[0])
  }

  // --- PositioningMatrix ---

  async savePositioningMatrix(matrix: PositioningMatrix): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.positioningMatrices) state.positioningMatrices = []
      state.positioningMatrices = state.positioningMatrices.filter(
        (m) =>
          !(
            m.id === matrix.id &&
            m.workspaceId === matrix.workspaceId &&
            m.projectId === matrix.projectId
          )
      )
      state.positioningMatrices.push(deepClone(matrix))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getPositioningMatrix(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<PositioningMatrix | null> {
    const state = this.db.getActiveState()
    const list = (state.positioningMatrices ?? []).filter(
      (m) => m.projectId === projectId && m.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    return deepClone(sorted[0])
  }

  // --- DifferentiationAnalysis ---

  async saveDifferentiationAnalysis(analysis: DifferentiationAnalysis): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.differentiationAnalyses) state.differentiationAnalyses = []
      state.differentiationAnalyses = state.differentiationAnalyses.filter(
        (a) =>
          !(
            a.id === analysis.id &&
            a.workspaceId === analysis.workspaceId &&
            a.projectId === analysis.projectId
          )
      )
      state.differentiationAnalyses.push(deepClone(analysis))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getDifferentiationAnalysis(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<DifferentiationAnalysis | null> {
    const state = this.db.getActiveState()
    const list = (state.differentiationAnalyses ?? []).filter(
      (a) => a.projectId === projectId && a.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    return deepClone(sorted[0])
  }

  // --- MarketOpportunity ---

  async saveMarketOpportunity(opp: MarketOpportunity): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.marketOpportunities) state.marketOpportunities = []
      state.marketOpportunities = state.marketOpportunities.filter(
        (o) =>
          !(o.id === opp.id && o.workspaceId === opp.workspaceId && o.projectId === opp.projectId)
      )
      state.marketOpportunities.push(deepClone(opp))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getMarketOpportunitiesByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<MarketOpportunity[]> {
    const state = this.db.getActiveState()
    return (state.marketOpportunities ?? [])
      .filter((o) => o.projectId === projectId && o.workspaceId === workspaceId)
      .map(deepClone)
  }

  // --- CompetitorRecommendation ---

  async saveCompetitorRecommendation(rec: CompetitorRecommendation): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.competitorRecommendations) state.competitorRecommendations = []
      state.competitorRecommendations = state.competitorRecommendations.filter(
        (r) =>
          !(r.id === rec.id && r.workspaceId === rec.workspaceId && r.projectId === rec.projectId)
      )
      state.competitorRecommendations.push(deepClone(rec))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getCompetitorRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<CompetitorRecommendation[]> {
    const state = this.db.getActiveState()
    return (state.competitorRecommendations ?? [])
      .filter((r) => r.projectId === projectId && r.workspaceId === workspaceId)
      .map(deepClone)
  }

  async deleteCompetitorRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.competitorRecommendations) {
        state.competitorRecommendations = state.competitorRecommendations.filter(
          (r) => !(r.projectId === projectId && r.workspaceId === workspaceId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
