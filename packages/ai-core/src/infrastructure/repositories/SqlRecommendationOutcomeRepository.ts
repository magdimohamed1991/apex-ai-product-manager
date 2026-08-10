import type { WorkspaceId } from '../../domain/value-objects'
import type { RecommendationOutcome } from '../../domain/entities/RecommendationOutcome'
import type { RecommendationOutcomeRepository } from '../../domain/repositories/RecommendationOutcomeRepository'
import { DurableFileDatabase } from '../database/DurableFileDatabase'

function mapOutcomeFromDb(o: RecommendationOutcome): RecommendationOutcome {
  return {
    ...o,
    detectedAt: new Date(String(o.detectedAt)),
    resolvedAt: o.resolvedAt ? new Date(String(o.resolvedAt)) : null,
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

  async getByIdAndWorkspace(
    id: string,
    workspaceId: WorkspaceId
  ): Promise<RecommendationOutcome | null> {
    const state = this.db.getActiveState()
    const found = state.outcomes?.find((o) => o.id === id && o.workspaceId === workspaceId)
    if (!found) return null
    return mapOutcomeFromDb(found)
  }

  async getByRecommendation(
    recId: string,
    workspaceId: WorkspaceId
  ): Promise<RecommendationOutcome | null> {
    const state = this.db.getActiveState()
    const found = state.outcomes?.find(
      (o) => o.recommendationId === recId && o.workspaceId === workspaceId
    )
    if (!found) return null
    return mapOutcomeFromDb(found)
  }

  async getByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<RecommendationOutcome[]> {
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
      // (id, workspaceId, projectId)-scoped upsert. A same-id outcome in a
      // DIFFERENT project of the SAME workspace must NOT clobber this
      // project's row (Phase 3 isolation invariant — Scenario A/B). Matches
      // the recommendation/finding/telemetry upsert guarantees.
      state.outcomes = state.outcomes.filter(
        (o) =>
          !(
            o.id === outcome.id &&
            o.workspaceId === outcome.workspaceId &&
            o.projectId === outcome.projectId
          )
      )
      state.outcomes.push(JSON.parse(JSON.stringify(outcome)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
