import type { IntegrationType, IntegrationStatus, WorkspaceId } from '../value-objects'

export interface Integration {
  id: string
  workspaceId: WorkspaceId
  type: IntegrationType
  status: IntegrationStatus
  config: IntegrationConfig
  lastSyncedAt: Date | null
  createdAt: Date
}

export interface IntegrationConfig {
  url?: string
  apiKey?: string
  token?: string
  identifier?: string
  metadata?: Record<string, unknown>
}
