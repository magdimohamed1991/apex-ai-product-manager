/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkspaceId } from '../../domain/value-objects'
import type { AdaptiveLearningProfile, LearningSignal } from '../../domain/entities/ProductAdaptive'
import type { AdaptiveLearningProfileRepository } from '../../domain/repositories/AdaptiveLearningProfileRepository'
import { DurableFileDatabase } from '../database/DurableFileDatabase'

function mapProfileFromDb(p: any): AdaptiveLearningProfile {
  return {
    ...p,
    lastCalculatedAt: new Date(p.lastCalculatedAt),
  } as AdaptiveLearningProfile
}

function mapSignalFromDb(s: any): LearningSignal {
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

  async getProfile(workspaceId: WorkspaceId, projectId: string): Promise<AdaptiveLearningProfile | null> {
    const state = this.db.getActiveState()
    const found = state.learningProfiles?.find((p) => p.workspaceId === workspaceId && p.projectId === projectId)
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
      
      const { workspaceId, projectId } = signals[0]
      // filter out old signals for this scope to avoid duplication and maintain auditable updates
      state.learningSignals = state.learningSignals.filter(
        (s) => s.workspaceId !== workspaceId || s.projectId !== projectId
      )
      
      for (const sig of signals) {
        state.learningSignals.push(JSON.parse(JSON.stringify(sig)))
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
