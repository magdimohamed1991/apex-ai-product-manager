import type { WorkspaceId } from '../value-objects'
import type { AdaptiveLearningProfile, LearningSignal } from '../entities/ProductAdaptive'

export interface AdaptiveLearningProfileRepository {
  getProfile(workspaceId: WorkspaceId, projectId: string): Promise<AdaptiveLearningProfile | null>
  saveProfile(profile: AdaptiveLearningProfile): Promise<void>
  
  getSignals(workspaceId: WorkspaceId, projectId: string): Promise<LearningSignal[]>
  saveSignals(signals: LearningSignal[]): Promise<void>
}
