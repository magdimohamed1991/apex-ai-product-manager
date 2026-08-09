import type { WorkspaceId } from '../../domain/value-objects'
import type { AdaptiveLearningProfile, LearningSignal } from '../../domain/entities/ProductAdaptive'
import type { AdaptiveLearningProfileRepository } from '../../domain/repositories/AdaptiveLearningProfileRepository'
import { DurableFileDatabase } from '../database/DurableFileDatabase'

function mapProfileFromDb(p: AdaptiveLearningProfile): AdaptiveLearningProfile {
  return {
    ...p,
    lastCalculatedAt: new Date(p.lastCalculatedAt),
  } as AdaptiveLearningProfile
}

function mapSignalFromDb(s: LearningSignal): LearningSignal {
  return {
    ...s,
    generatedAt: new Date(s.generatedAt),
  } as LearningSignal
}

/**
 * SQL-Compliant Adaptive Profiling Repository (Milestone H6)
 *
 * Implements multi-tenant isolated tracking of learning profiles and explicit learning signals.
 */
export class SqlAdaptiveLearningProfileRepository implements AdaptiveLearningProfileRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  async getProfile(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<AdaptiveLearningProfile | null> {
    const state = this.db.getActiveState()
    const found = state.learningProfiles?.find(
      (p) => p.workspaceId === workspaceId && p.projectId === projectId
    )
    if (!found) return null
    return mapProfileFromDb(found)
  }

  async saveProfile(profile: AdaptiveLearningProfile): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.learningProfiles) state.learningProfiles = []
      state.learningProfiles = state.learningProfiles.filter(
        (p) => p.workspaceId !== profile.workspaceId || p.projectId !== profile.projectId
      )
      state.learningProfiles.push(JSON.parse(JSON.stringify(profile)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getSignals(workspaceId: WorkspaceId, projectId: string): Promise<LearningSignal[]> {
    const state = this.db.getActiveState()
    const list = state.learningSignals || []
    return list
      .filter((s) => s.workspaceId === workspaceId && s.projectId === projectId)
      .map(mapSignalFromDb)
  }

  async saveSignals(signals: LearningSignal[]): Promise<void> {
    if (signals.length === 0) return
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.learningSignals) state.learningSignals = []

      // Upsert by (workspaceId, projectId, category, type). Signal IDs are
      // deterministic hashes of the observation set, so a NEW observation
      // set produces a NEW id for the same logical signal. Replacing only
      // by id would leave the old (stale) signal rows behind and the UI
      // would show both the old and the new signal for the same category.
      for (const sig of signals) {
        state.learningSignals = state.learningSignals.filter(
          (s) =>
            !(
              s.workspaceId === sig.workspaceId &&
              s.projectId === sig.projectId &&
              s.category === sig.category &&
              s.type === sig.type
            )
        )
        state.learningSignals.push(JSON.parse(JSON.stringify(sig)))
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
