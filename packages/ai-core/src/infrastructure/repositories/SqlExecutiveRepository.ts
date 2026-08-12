/**
 * SqlExecutiveRepository — H12 persistence adapter.
 *
 * Implements the ExecutiveRepository domain contract against the
 * DurableFileDatabase single-process store. All upserts are scoped by
 * (id, workspaceId, projectId) to preserve multi-tenant isolation.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { ExecutiveRepository } from '../../domain/repositories/ExecutiveRepository'
import type {
  ExecutiveDashboard,
  ExecutiveReport,
  ProductHealthSnapshot,
  TrendDetection,
} from '../../domain/entities/ExecutiveIntelligence'
import type { DurableFileDatabase } from '../database/DurableFileDatabase'

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export class SqlExecutiveRepository implements ExecutiveRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  // --- ExecutiveDashboard ---

  async saveExecutiveDashboard(dashboard: ExecutiveDashboard): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.executiveDashboards) state.executiveDashboards = []
      state.executiveDashboards = state.executiveDashboards.filter(
        (d) =>
          !(
            d.id === dashboard.id &&
            d.workspaceId === dashboard.workspaceId &&
            d.projectId === dashboard.projectId
          )
      )
      state.executiveDashboards.push(deepClone(dashboard))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getExecutiveDashboardByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ExecutiveDashboard | null> {
    const state = this.db.getActiveState()
    const list = (state.executiveDashboards ?? []).filter(
      (d) => d.projectId === projectId && d.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    return deepClone(sorted[0])
  }

  // --- ExecutiveReport ---

  async saveExecutiveReport(report: ExecutiveReport): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.executiveReports) state.executiveReports = []
      state.executiveReports = state.executiveReports.filter(
        (r) =>
          !(
            r.id === report.id &&
            r.workspaceId === report.workspaceId &&
            r.projectId === report.projectId
          )
      )
      state.executiveReports.push(deepClone(report))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getExecutiveReportById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ExecutiveReport | null> {
    const state = this.db.getActiveState()
    const r = (state.executiveReports ?? []).find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return r ? deepClone(r) : null
  }

  async getExecutiveReportsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ExecutiveReport[]> {
    const state = this.db.getActiveState()
    return (state.executiveReports ?? [])
      .filter((r) => r.projectId === projectId && r.workspaceId === workspaceId)
      .map(deepClone)
  }

  // --- ProductHealthSnapshot ---

  async saveProductHealthSnapshot(snapshot: ProductHealthSnapshot): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.productHealthSnapshots) state.productHealthSnapshots = []
      state.productHealthSnapshots = state.productHealthSnapshots.filter(
        (s) =>
          !(
            s.id === snapshot.id &&
            s.workspaceId === snapshot.workspaceId &&
            s.projectId === snapshot.projectId
          )
      )
      state.productHealthSnapshots.push(deepClone(snapshot))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getLatestProductHealthSnapshot(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ProductHealthSnapshot | null> {
    const state = this.db.getActiveState()
    const list = (state.productHealthSnapshots ?? []).filter(
      (s) => s.projectId === projectId && s.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime())
    return deepClone(sorted[0])
  }

  async getProductHealthSnapshotsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ProductHealthSnapshot[]> {
    const state = this.db.getActiveState()
    return (state.productHealthSnapshots ?? [])
      .filter((s) => s.projectId === projectId && s.workspaceId === workspaceId)
      .map(deepClone)
  }

  // --- TrendDetection ---

  async saveTrendDetection(trend: TrendDetection): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.trendDetections) state.trendDetections = []
      state.trendDetections = state.trendDetections.filter(
        (t) =>
          !(
            t.id === trend.id &&
            t.workspaceId === trend.workspaceId &&
            t.projectId === trend.projectId
          )
      )
      state.trendDetections.push(deepClone(trend))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getTrendDetectionsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<TrendDetection[]> {
    const state = this.db.getActiveState()
    return (state.trendDetections ?? [])
      .filter((t) => t.projectId === projectId && t.workspaceId === workspaceId)
      .map(deepClone)
  }

  async deleteTrendDetectionsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.trendDetections) {
        state.trendDetections = state.trendDetections.filter(
          (t) => !(t.projectId === projectId && t.workspaceId === workspaceId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
