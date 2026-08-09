import type { Action } from '../../domain/entities'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import type { WorkspaceId } from '../../domain/value-objects'
import { ActionExecutor } from './ActionExecutor'
import type { AdapterContext } from './ActionApplicationService'

/**
 * Action Execution Worker (Milestone C)
 *
 * Implements the background execution worker contract.
 * Polling, claiming, and processing pending, unexecuted, or retry Actions safely and idempotently.
 */
export class ActionExecutionWorker {
  constructor(
    private readonly repository: ActionRepository,
    private readonly executor: ActionExecutor
  ) {}

  /**
   * Discovers and processes all outstanding Actions in the workspace.
   *
   * Coordinates:
   *   1. Discover: poll pending actions from repository.
   *   2. Claim: atomically lock action.
   *   3. Execute: delegate side effects to Executor.
   */
  async processPendingActions(workspaceId: WorkspaceId, context: AdapterContext): Promise<Action[]> {
    // 1. Discover: Load all ready, expired, or pending retry Actions (Item 8)
    const pendingActions = await this.repository.getPendingActionsAndWorkspace(workspaceId)
    const processed: Action[] = []

    for (const action of pendingActions) {
      try {
        // 2. Claim & Execute: delegating concurrency locking and execution outcomes atomically (Item 8)
        await this.executor.execute(action.id, workspaceId, context)

        // Load finalized record to return
        const finalState = await this.repository.getByIdAndWorkspace(action.id, workspaceId)
        if (finalState) {
          processed.push(finalState)
        }
      } catch (err) {
        // Concurrency lock collision or terminal failure. Log and continue gracefully.
        console.warn(`[Worker] Failed to process Action "${action.id}":`, err instanceof Error ? err.message : err)
      }
    }

    return processed
  }
}
