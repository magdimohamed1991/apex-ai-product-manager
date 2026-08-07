import type { WorkspaceId } from '../value-objects'
import type { SourceType } from './SourceType'

export type SourceStatus = 'active' | 'inactive' | 'error' | 'pending'

/**
 * A Source represents a connected data integration for a Workspace.
 * Sources produce Evidence that flows into the Correlation Engine.
 */
export interface Source {
  id: string
  workspaceId: WorkspaceId
  type: SourceType
  name: string
  status: SourceStatus
  connectedAt: Date
  lastSyncedAt: Date | null
  metadata: SourceMetadata
}

export interface SourceMetadata {
  url?: string
  identifier?: string // repo name, channel name, app id...
  region?: string
  version?: string
  extra?: Record<string, unknown>
}
