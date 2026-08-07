import type { Finding, FindingType } from '../entities'
import type { WorkspaceId, Priority } from '../value-objects'

export interface FindingFilter {
  workspaceId: WorkspaceId
  type?: FindingType
  priority?: Priority
  limit?: number
}

/**
 * Contract for Finding persistence.
 */
export interface FindingRepository {
  getById(id: string): Promise<Finding | null>
  getByWorkspace(filter: FindingFilter): Promise<Finding[]>
  save(finding: Finding): Promise<void>
  saveMany(findings: Finding[]): Promise<void>
  delete(id: string): Promise<void>
}
