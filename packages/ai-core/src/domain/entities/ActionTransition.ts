import type { WorkspaceId, ActionStatus } from '../value-objects'

/**
 * Audit log of an Action status transition.
 * Standardizes security compliance and chronological trace auditing.
 */
export interface ActionTransition {
  id: string
  actionId: string
  workspaceId: WorkspaceId
  fromStatus: ActionStatus
  toStatus: ActionStatus
  sequence: number // Monotonically increasing sequence number (e.g. 1, 2, 3...) per Action status change
  timestamp: Date
  actor: string // e.g. "agent:repository-intelligence", "system"
  reason: string | null
}

/**
 * Validates the ActionTransition invariants.
 */
export function validateActionTransitionRecord(transition: ActionTransition): void {
  if (!transition.id || transition.id.trim().length === 0) {
    throw new Error('ActionTransition must have a valid non-empty id')
  }
  if (!transition.actionId || transition.actionId.trim().length === 0) {
    throw new Error('ActionTransition must be linked to a valid non-empty actionId')
  }
  if (!transition.workspaceId || transition.workspaceId.trim().length === 0) {
    throw new Error('ActionTransition must have a valid non-empty workspaceId')
  }
  if (transition.sequence < 1) {
    throw new Error('ActionTransition sequence number must be greater than or equal to 1')
  }
  if (!transition.actor || transition.actor.trim().length === 0) {
    throw new Error('ActionTransition must have a non-empty actor')
  }
}

/**
 * Domain factory to safely construct an Action transition audit record.
 */
export function createActionTransitionRecord(
  data: Omit<ActionTransition, 'id' | 'timestamp'> & {
    id?: string
    timestamp?: Date
  }
): ActionTransition {
  const transition: ActionTransition = {
    id: data.id ?? crypto.randomUUID(),
    actionId: data.actionId,
    workspaceId: data.workspaceId,
    fromStatus: data.fromStatus,
    toStatus: data.toStatus,
    sequence: data.sequence,
    timestamp: data.timestamp ?? new Date(),
    actor: data.actor,
    reason: data.reason,
  }

  validateActionTransitionRecord(transition)
  return transition
}
