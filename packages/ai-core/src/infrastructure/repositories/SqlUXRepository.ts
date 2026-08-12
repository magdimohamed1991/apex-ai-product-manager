/**
 * SqlUXRepository — H10 persistence adapter.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { UXRepository } from '../../domain/repositories/UXRepository'
import type {
  UserJourney,
  FrictionPoint,
  UXAnalysis,
  UXRecommendation,
} from '../../domain/entities/UXIntelligence'
import type { DurableFileDatabase } from '../database/DurableFileDatabase'

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export class SqlUXRepository implements UXRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  // --- UserJourney ---

  async saveUserJourney(journey: UserJourney): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.userJourneys) state.userJourneys = []
      state.userJourneys = state.userJourneys.filter(
        (j) =>
          !(
            j.id === journey.id &&
            j.workspaceId === journey.workspaceId &&
            j.projectId === journey.projectId
          )
      )
      state.userJourneys.push(deepClone(journey))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getUserJourneyById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<UserJourney | null> {
    const state = this.db.getActiveState()
    const j = (state.userJourneys ?? []).find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return j ? deepClone(j) : null
  }

  async getUserJourneysByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<UserJourney[]> {
    const state = this.db.getActiveState()
    return (state.userJourneys ?? [])
      .filter((j) => j.projectId === projectId && j.workspaceId === workspaceId)
      .map(deepClone)
  }

  async deleteUserJourneysByProject(projectId: string, workspaceId: WorkspaceId): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.userJourneys) {
        state.userJourneys = state.userJourneys.filter(
          (j) => !(j.projectId === projectId && j.workspaceId === workspaceId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  // --- FrictionPoint ---

  async saveFrictionPoint(fp: FrictionPoint): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.frictionPoints) state.frictionPoints = []
      state.frictionPoints = state.frictionPoints.filter(
        (f) => !(f.id === fp.id && f.workspaceId === fp.workspaceId && f.projectId === fp.projectId)
      )
      state.frictionPoints.push(deepClone(fp))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getFrictionPointsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<FrictionPoint[]> {
    const state = this.db.getActiveState()
    return (state.frictionPoints ?? [])
      .filter((f) => f.projectId === projectId && f.workspaceId === workspaceId)
      .map(deepClone)
  }

  async deleteFrictionPointsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.frictionPoints) {
        state.frictionPoints = state.frictionPoints.filter(
          (f) => !(f.projectId === projectId && f.workspaceId === workspaceId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  // --- UXAnalysis ---

  async saveUXAnalysis(analysis: UXAnalysis): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.uxAnalyses) state.uxAnalyses = []
      state.uxAnalyses = state.uxAnalyses.filter(
        (a) =>
          !(
            a.id === analysis.id &&
            a.workspaceId === analysis.workspaceId &&
            a.projectId === analysis.projectId
          )
      )
      state.uxAnalyses.push(deepClone(analysis))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getUXAnalysisByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<UXAnalysis | null> {
    const state = this.db.getActiveState()
    const list = (state.uxAnalyses ?? []).filter(
      (a) => a.projectId === projectId && a.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    return deepClone(sorted[0])
  }

  // --- UXRecommendation ---

  async saveUXRecommendation(rec: UXRecommendation): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.uxRecommendations) state.uxRecommendations = []
      state.uxRecommendations = state.uxRecommendations.filter(
        (r) =>
          !(r.id === rec.id && r.workspaceId === rec.workspaceId && r.projectId === rec.projectId)
      )
      state.uxRecommendations.push(deepClone(rec))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getUXRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<UXRecommendation[]> {
    const state = this.db.getActiveState()
    return (state.uxRecommendations ?? [])
      .filter((r) => r.projectId === projectId && r.workspaceId === workspaceId)
      .map(deepClone)
  }

  async deleteUXRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.uxRecommendations) {
        state.uxRecommendations = state.uxRecommendations.filter(
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
