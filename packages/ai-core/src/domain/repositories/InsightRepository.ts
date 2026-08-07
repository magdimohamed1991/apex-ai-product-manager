import type { Insight } from '../entities'
import type { WorkspaceId, IntegrationType, Severity } from '../value-objects'

export interface InsightFilter {
  workspaceId: WorkspaceId
  source?: IntegrationType
  severity?: Severity
  limit?: number
}

/**
 * Contract for Insight persistence.
 */
export interface InsightRepository {
  getById(id: string): Promise<Insight | null>
  getByWorkspace(filter: InsightFilter): Promise<Insight[]>
  save(insight: Insight): Promise<void>
  saveMany(insights: Insight[]): Promise<void>
  delete(id: string): Promise<void>
}
