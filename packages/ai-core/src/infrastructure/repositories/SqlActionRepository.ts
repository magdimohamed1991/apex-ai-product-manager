import type { Action, Execution, ActionTransition, ExecutionFailureClass } from '../../domain/entities'
import type { ActionRepository, ActionFilter } from '../../domain/repositories/ActionRepository'
import type { WorkspaceId } from '../../domain/value-objects'
import { DurableFileDatabase } from '../database/DurableFileDatabase'

/**
 * Normalization helpers to translate database JSON formats back to rich Domain Entities with Date objects.
 */
function mapActionFromDb(action: unknown): Action {
  const a = action as Record<string, unknown>
  return {
    ...a,
    createdAt: new Date(a.createdAt as string),
    updatedAt: new Date(a.updatedAt as string),
    leaseExpiresAt: a.leaseExpiresAt ? new Date(a.leaseExpiresAt as string) : null,
    nextAttemptAt: a.nextAttemptAt ? new Date(a.nextAttemptAt as string) : null,
  } as Action
}

function mapExecutionFromDb(e: unknown): Execution {
  const exec = e as Record<string, unknown>
  const err = exec.error as Record<string, unknown> | null
  return {
    ...exec,
    startedAt: new Date(exec.startedAt as string),
    completedAt: exec.completedAt ? new Date(exec.completedAt as string) : null,
    error: err
      ? {
          code: err.code as ExecutionFailureClass,
          message: err.message as string,
          retryable: err.retryable as boolean,
          retryAfterMs: err.retryAfterMs as number | undefined,
          timestamp: new Date(err.timestamp as string),
        }
      : null,
  } as unknown as Execution
}

function mapTransitionFromDb(t: unknown): ActionTransition {
  const trans = t as Record<string, unknown>
  return {
    ...trans,
    timestamp: new Date(trans.timestamp as string),
  } as unknown as ActionTransition
}

/**
 * SQL-Compliant Relational Persistence Adapter (Milestone D)
 *
 * Implements the domain Repository contract completely decoupled from database concerns,
 * backed by the atomic, ACID-compliant DurableFileDatabase.
 */
export class SqlActionRepository implements ActionRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  async getByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<Action | null> {
    const state = this.db.getActiveState()
    const action = state.actions.find((a) => a.id === id && a.workspaceId === workspaceId)
    if (!action) return null
    return mapActionFromDb(action)
  }

  async getByIdempotencyKeyAndWorkspace(key: string, workspaceId: WorkspaceId): Promise<Action | null> {
    const state = this.db.getActiveState()
    const action = state.actions.find((a) => a.idempotencyKey === key && a.workspaceId === workspaceId)
    if (!action) return null
    return mapActionFromDb(action)
  }

  async getByWorkspace(filter: ActionFilter): Promise<Action[]> {
    const state = this.db.getActiveState()
    const results = state.actions.filter(
      (a) => a.workspaceId === filter.workspaceId && (!filter.status || a.status === filter.status)
    )
    const mapped = results.map((a) => mapActionFromDb(a))
    if (filter.limit !== undefined) {
      return mapped.slice(0, filter.limit)
    }
    return mapped
  }

  async save(action: Action): Promise<void> {
    this.db.beginTransaction()
    try {
      this.db.insertAction(action)
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async deleteAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      state.actions = state.actions.filter((a) => !(a.id === id && a.workspaceId === workspaceId))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  // Atomic state claiming with lease support and execution reconciliation (Item 1 & Item 2)
  async claimForExecution(
    actionId: string,
    workspaceId: WorkspaceId,
    executionId: string,
    leaseDurationMs: number
  ): Promise<boolean> {
    this.db.beginTransaction()
    try {
      const action = await this.getByIdAndWorkspace(actionId, workspaceId)
      if (!action) {
        this.db.rollback()
        return false
      }

      const now = Date.now()
      const isQueued = action.status === 'queued' || action.status === 'approved'
      const isLeaseCleared = action.status === 'in-progress' && action.claimedByExecutionId === null
      const isLeaseExpired =
        action.status === 'in-progress' &&
        action.leaseExpiresAt !== null &&
        new Date(action.leaseExpiresAt).getTime() < now

      if (isQueued || isLeaseCleared || isLeaseExpired) {
        if (isLeaseExpired && action.claimedByExecutionId) {
          // Reclaim previous orphaned execution and mark failed
          const previousExecutionId = action.claimedByExecutionId
          const state = this.db.getActiveState()
          const prevExec = state.executions.find((e) => e.id === previousExecutionId)
          if (prevExec) {
            prevExec.status = 'failed'
            prevExec.completedAt = new Date()
            prevExec.error = {
              code: 'timeout',
              message: 'Execution abandoned: lease expired',
              retryable: true,
              timestamp: new Date(),
            }
            this.db.insertExecution(prevExec)
          }
        }

        action.status = 'in-progress'
        action.claimedByExecutionId = executionId
        action.leaseExpiresAt = new Date(now + leaseDurationMs)
        action.updatedAt = new Date()
        this.db.insertAction(action)
        await this.db.commit()
        return true
      }

      this.db.rollback()
      return false
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async saveExecution(execution: Execution): Promise<void> {
    this.db.beginTransaction()
    try {
      this.db.insertExecution(execution)
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getExecutionsByAction(actionId: string, workspaceId: WorkspaceId): Promise<Execution[]> {
    const state = this.db.getActiveState()
    return state.executions
      .filter((e) => e.actionId === actionId && e.workspaceId === workspaceId)
      .map((e) => mapExecutionFromDb(e))
  }

  async saveTransition(transition: ActionTransition): Promise<void> {
    this.db.beginTransaction()
    try {
      this.db.insertTransition(transition)
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getTransitionsByAction(actionId: string, workspaceId: WorkspaceId): Promise<ActionTransition[]> {
    const state = this.db.getActiveState()
    return state.transitions
      .filter((t) => t.actionId === actionId && t.workspaceId === workspaceId)
      .map((t) => mapTransitionFromDb(t))
  }

  // Atomic outcome persistence boundary (Item 5 & Item 6)
  async persistExecutionOutcome(
    action: Action,
    execution: Execution,
    transition: ActionTransition
  ): Promise<void> {
    this.db.beginTransaction()
    try {
      const liveAction = await this.getByIdAndWorkspace(action.id, action.workspaceId)
      if (!liveAction) {
        throw new Error('Action not found or unauthorized')
      }

      // Concurrency safety check
      if (liveAction.claimedByExecutionId !== execution.id) {
        throw new Error(
          `Lease ownership violation: concurrent worker has taken over. Expected claim: "${execution.id}", actual live claim: "${liveAction.claimedByExecutionId}"`
        )
      }

      this.db.insertAction(action)
      this.db.insertExecution(execution)
      this.db.insertTransition(transition)
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getPendingActionsAndWorkspace(workspaceId: WorkspaceId): Promise<Action[]> {
    const state = this.db.getActiveState()
    const list: Action[] = []
    const now = new Date()
    for (const action of state.actions) {
      if (action.workspaceId !== workspaceId) continue

      const isQueuedOrApproved = action.status === 'approved' || action.status === 'queued'

      const isLeaseCleared =
        action.status === 'in-progress' &&
        action.claimedByExecutionId === null &&
        (action.nextAttemptAt === null || new Date(action.nextAttemptAt) <= now)

      const isLeaseExpired =
        action.status === 'in-progress' &&
        action.leaseExpiresAt !== null &&
        new Date(action.leaseExpiresAt) <= now

      if (isQueuedOrApproved || isLeaseCleared || isLeaseExpired) {
        list.push(mapActionFromDb(action))
      }
    }
    return list
  }
}
export { mapActionFromDb, mapExecutionFromDb, mapTransitionFromDb }
