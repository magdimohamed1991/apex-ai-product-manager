import type { WorkspaceId } from '../value-objects'

/**
 * Domain events are facts that happened in the domain.
 * Agents and workflows can emit and listen to these events.
 */

export interface DomainEvent {
  id: string
  type: string
  workspaceId: WorkspaceId
  occurredAt: Date
  payload: unknown
}

export interface WorkspaceCreatedEvent extends DomainEvent {
  type: 'workspace.created'
  payload: { workspaceId: WorkspaceId }
}

export interface IntegrationConnectedEvent extends DomainEvent {
  type: 'integration.connected'
  payload: { integrationId: string; integrationType: string }
}

export interface InsightsGeneratedEvent extends DomainEvent {
  type: 'insights.generated'
  payload: { insightIds: string[]; source: string; count: number }
}

export interface FindingsGeneratedEvent extends DomainEvent {
  type: 'findings.generated'
  payload: { findingIds: string[]; count: number }
}

export type ApexDomainEvent =
  | WorkspaceCreatedEvent
  | IntegrationConnectedEvent
  | InsightsGeneratedEvent
  | FindingsGeneratedEvent
