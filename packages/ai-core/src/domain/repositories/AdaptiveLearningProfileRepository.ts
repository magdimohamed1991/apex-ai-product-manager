import type { WorkspaceId } from '../value-objects'
import type { AdaptiveLearningProfile, LearningSignal } from '../entities/ProductAdaptive'

export interface AdaptiveLearningProfileRepository {
  getProfile(workspaceId: WorkspaceId, projectId: string): Promise<AdaptiveLearningProfile | null>
  saveProfile(profile: AdaptiveLearningProfile): Promise<void>

  getSignals(workspaceId: WorkspaceId, projectId: string): Promise<LearningSignal[]>
  saveSignals(signals: LearningSignal[]): Promise<void>

  /**
   * Remove every learning signal recorded for a project. Used by profile
   * recompilation so signals are always a pure function of the CURRENT
   * observation set: when a category disappears (or drops below the
   * signal-generation threshold), its previously compiled signals must not
   * keep influencing calibration.
   */
  deleteSignalsByProject(workspaceId: WorkspaceId, projectId: string): Promise<void>
}
