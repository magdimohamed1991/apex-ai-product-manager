import type { Action } from '../entities'
import type { Execution } from '../entities/Execution'
import type { ActionTransition } from '../entities/ActionTransition'
import type { WorkspaceId } from '../value-objects'

export interface ActionFilter {
  workspaceId: WorkspaceId
  status?: Action['status']
  limit?: number
}

/**
 * Persistence Boundary Contract for Action Entity and its related histories.
 * Handles storage, retrieval, and querying of result states.
 */
export interface ActionRepository {
  getByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<Action | null>
  getByIdempotencyKeyAndWorkspace(key: string, workspaceId: WorkspaceId): Promise<Action | null>
  getByWorkspace(filter: ActionFilter): Promise<Action[]>
  save(action: Action): Promise<void>
  deleteAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<void>

  // Atomic state claiming to prevent concurrent race conditions (Item 2)
  claimForExecution(
    actionId: string,
    workspaceId: WorkspaceId,
    executionId: string,
    leaseDurationMs: number
  ): Promise<boolean>

  // Execution attempts logging (Item 5)
  saveExecution(execution: Execution): Promise<void>
  getExecutionsByAction(actionId: string, workspaceId: WorkspaceId): Promise<Execution[]>

  // Transition logs auditing (Item 5)
  saveTransition(transition: ActionTransition): Promise<void>
  getTransitionsByAction(actionId: string, workspaceId: WorkspaceId): Promise<ActionTransition[]>

  // Atomic local outcome persistence transaction (Item 5 & Item 6)
  persistExecutionOutcome(
    action: Action,
    execution: Execution,
    transition: ActionTransition
  ): Promise<void>

  // Worker Discover query support (Item 8)
  getPendingActionsAndWorkspace(workspaceId: WorkspaceId): Promise<Action[]>
}
