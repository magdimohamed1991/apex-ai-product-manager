/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkspaceId } from '../../domain/value-objects'
import type { RecommendationOutcome } from '../../domain/entities/RecommendationOutcome'
import type { RecommendationOutcomeRepository } from '../../domain/repositories/RecommendationOutcomeRepository'
import { DurableFileDatabase } from '../database/DurableFileDatabase'

function mapOutcomeFromDb(o: any): RecommendationOutcome {
  return {
    ...o,
    detectedAt: new Date(o.detectedAt as string),
    resolvedAt: o.resolvedAt ? new Date(o.resolvedAt as string) : null,
  } as RecommendationOutcome
}

/**
 * SQL-Compliant Outcome Repository Adapter (Milestone H5)
 *
 * Persists and queries verified outcome records against the ACID-safe DurableFileDatabase,
 * strictly workspace-isolated.
 */
export class SqlRecommendationOutcomeRepository implements RecommendationOutcomeRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  async getByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<RecommendationOutcome | null> {
    const state = this.db.getActiveState()
    const found = state.outcomes?.find((o) => o.id === id && o.workspaceId === workspaceId)
    if (!found) return null
    return mapOutcomeFromDb(found)
  }

  async getByRecommendation(recId: string, workspaceId: WorkspaceId): Promise<RecommendationOutcome | null> {
    const state = this.db.getActiveState()
    const found = state.outcomes?.find((o) => o.recommendationId === recId && o.workspaceId === workspaceId)
    if (!found) return null
    return mapOutcomeFromDb(found)
  }

  async getByProject(projectId: string, workspaceId: WorkspaceId): Promise<RecommendationOutcome[]> {
    const state = this.db.getActiveState()
    const list = state.outcomes || []
    return list
      .filter((o) => o.projectId === projectId && o.workspaceId === workspaceId)
      .map(mapOutcomeFromDb)
  }

  async save(outcome: RecommendationOutcome): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.outcomes) state.outcomes = []
      state.outcomes = state.outcomes.filter((o) => o.id !== outcome.id)
      state.outcomes.push(JSON.parse(JSON.stringify(outcome)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
