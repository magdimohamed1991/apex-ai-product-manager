import type { WorkspaceId, Priority } from '../value-objects'
import type { Finding } from './Finding'

export type EffortLevel = 'low' | 'medium' | 'high'

export interface Recommendation {
  id: string
  workspaceId: WorkspaceId
  title: string
  reason: string
  impact: string
  effort: EffortLevel
  priority: Priority
  confidence: number // 0–1
  relatedFindings: Finding['id'][]
  createdAt: Date
}
