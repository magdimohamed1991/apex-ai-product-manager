import type { WorkspaceId } from '../../domain'

/**
 * Context passed to every agent execution.
 * Contains workspace scope, correlation tracking, and timing.
 */
export interface AgentContext {
  workspaceId: WorkspaceId
  correlationId: string
  startedAt: Date
  metadata?: Record<string, unknown>
}
