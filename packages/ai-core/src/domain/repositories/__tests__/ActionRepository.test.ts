import { describe, it, expect } from 'vitest'
import type { Action, Execution, ActionTransition } from '../../entities'
import { createAction } from '../../entities/Action'
import { createWorkspaceId } from '../../value-objects'
import type { WorkspaceId } from '../../value-objects'
import type { ActionRepository, ActionFilter } from '../ActionRepository'

const WORKSPACE_A = createWorkspaceId('ws-persistence-a')
const WORKSPACE_B = createWorkspaceId('ws-persistence-b')

/**
 * Pure In-Memory Implementation of ActionRepository.
 * Follows strict deep-cloning, workspace-isolation, and lease ownership contracts.
 */
export class InMemoryActionRepository implements ActionRepository {
  private readonly storage = new Map<string, Action>()
  private readonly executions = new Map<string, Execution[]>()
  private readonly transitions = new Map<string, ActionTransition[]>()

  async save(action: Action): Promise<void> {
    // Concurrency semantics: Unique Idempotency Key Constraint simulation.
    // If an action with the same idempotency key already exists under a different action ID, reject it.
    for (const existing of this.storage.values()) {
      if (existing.idempotencyKey === action.idempotencyKey && existing.id !== action.id) {
        throw new Error(`Unique constraint violation: duplicate idempotencyKey "${action.idempotencyKey}"`)
      }
    }

    // Explicit Upsert Semantics: new ID -> insert, existing ID -> replace.
    // Deep copy to prevent sharing object references between the domain and storage.
    const cloned: Action = {
      ...action,
      createdAt: new Date(action.createdAt.getTime()),
      updatedAt: new Date(action.updatedAt.getTime()),
      leaseExpiresAt: action.leaseExpiresAt ? new Date(action.leaseExpiresAt.getTime()) : null,
      nextAttemptAt: action.nextAttemptAt ? new Date(action.nextAttemptAt.getTime()) : null,
    }
    this.storage.set(action.id, cloned)
  }

  async getById(id: string): Promise<Action | null> {
    const found = this.storage.get(id)
    if (!found) return null
    return {
      ...found,
      createdAt: new Date(found.createdAt.getTime()),
      updatedAt: new Date(found.updatedAt.getTime()),
      leaseExpiresAt: found.leaseExpiresAt ? new Date(found.leaseExpiresAt.getTime()) : null,
      nextAttemptAt: found.nextAttemptAt ? new Date(found.nextAttemptAt.getTime()) : null,
    }
  }

  async getByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<Action | null> {
    const found = await this.getById(id)
    if (!found || found.workspaceId !== workspaceId) return null
    return found
  }

  async getByIdempotencyKey(key: string): Promise<Action | null> {
    for (const action of this.storage.values()) {
      if (action.idempotencyKey === key) {
        return {
          ...action,
          createdAt: new Date(action.createdAt.getTime()),
          updatedAt: new Date(action.updatedAt.getTime()),
          leaseExpiresAt: action.leaseExpiresAt ? new Date(action.leaseExpiresAt.getTime()) : null,
          nextAttemptAt: action.nextAttemptAt ? new Date(action.nextAttemptAt.getTime()) : null,
        }
      }
    }
    return null
  }

  async getByIdempotencyKeyAndWorkspace(key: string, workspaceId: WorkspaceId): Promise<Action | null> {
    const found = await this.getByIdempotencyKey(key)
    if (!found || found.workspaceId !== workspaceId) return null
    return found
  }

  async getByWorkspace(filter: ActionFilter): Promise<Action[]> {
    const list: Action[] = []
    for (const action of this.storage.values()) {
      if (action.workspaceId !== filter.workspaceId) continue
      if (filter.status && action.status !== filter.status) continue

      const cloned: Action = {
        ...action,
        createdAt: new Date(action.createdAt.getTime()),
        updatedAt: new Date(action.updatedAt.getTime()),
        leaseExpiresAt: action.leaseExpiresAt ? new Date(action.leaseExpiresAt.getTime()) : null,
        nextAttemptAt: action.nextAttemptAt ? new Date(action.nextAttemptAt.getTime()) : null,
      }
      list.push(cloned)
    }

    if (filter.limit !== undefined) {
      return list.slice(0, filter.limit)
    }
    return list
  }

  async delete(id: string): Promise<void> {
    this.storage.delete(id)
  }

  async deleteAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<void> {
    const found = await this.getById(id)
    if (found && found.workspaceId === workspaceId) {
      this.storage.delete(id)
    }
  }

  // Atomic state claiming with lease support and execution reconciliation (Item 1 & Item 2)
  async claimForExecution(
    actionId: string,
    workspaceId: WorkspaceId,
    executionId: string,
    leaseDurationMs: number
  ): Promise<boolean> {
    const action = await this.getById(actionId)
    if (!action || action.workspaceId !== workspaceId) return false

    const now = Date.now()
    const isQueued = action.status === 'queued' || action.status === 'approved'
    const isLeaseCleared = action.status === 'in-progress' && action.claimedByExecutionId === null
    const isLeaseExpired =
      action.status === 'in-progress' &&
      action.leaseExpiresAt !== null &&
      action.leaseExpiresAt.getTime() < now

    if (isQueued || isLeaseCleared || isLeaseExpired) {
      if (isLeaseExpired && action.claimedByExecutionId) {
        // Explicit Reconciliation (Item 1): Reclaim previous orphaned execution and mark it failed
        const previousExecutionId = action.claimedByExecutionId
        const list = this.executions.get(actionId) ?? []
        const prevExec = list.find((e) => e.id === previousExecutionId)
        if (prevExec) {
          prevExec.status = 'failed'
          prevExec.completedAt = new Date()
          prevExec.error = {
            code: 'timeout',
            message: 'Execution abandoned: lease expired',
            retryable: true,
            timestamp: new Date(),
          }
          await this.saveExecution(prevExec)
        }
      }

      action.status = 'in-progress'
      action.claimedByExecutionId = executionId
      action.leaseExpiresAt = new Date(now + leaseDurationMs)
      action.updatedAt = new Date()
      await this.save(action)
      return true
    }

    return false
  }

  // Atomic local outcome persistence with lease ownership verification (Item 2 & Item 6)
  async persistExecutionOutcome(
    action: Action,
    execution: Execution,
    transition: ActionTransition
  ): Promise<void> {
    const liveAction = await this.getById(action.id)
    if (!liveAction || liveAction.workspaceId !== action.workspaceId) {
      throw new Error('Action not found or unauthorized')
    }

    // Lease ownership validation (Item 2): Stale workers must be prevented from writing
    if (liveAction.claimedByExecutionId !== execution.id) {
      throw new Error(
        `Lease ownership violation: concurrent worker has taken over. Expected claim: "${execution.id}", actual live claim: "${liveAction.claimedByExecutionId}"`
      )
    }

    // Atomic consistency transaction (Item 6): All three must remain fully consistent
    await this.save(action)
    await this.saveExecution(execution)
    await this.saveTransition(transition)
  }

  // Execution attempts logging
  async saveExecution(execution: Execution): Promise<void> {
    const list = this.executions.get(execution.actionId) ?? []
    const filtered = list.filter((e) => e.idempotencyKey !== execution.idempotencyKey)
    filtered.push({
      ...execution,
      startedAt: new Date(execution.startedAt.getTime()),
      completedAt: execution.completedAt ? new Date(execution.completedAt.getTime()) : null,
    })
    this.executions.set(execution.actionId, filtered)
  }

  async getExecutionsByAction(actionId: string, workspaceId: WorkspaceId): Promise<Execution[]> {
    const action = await this.getById(actionId)
    if (!action || action.workspaceId !== workspaceId) return []

    const list = this.executions.get(actionId) ?? []
    return list.map((e) => ({
      ...e,
      startedAt: new Date(e.startedAt.getTime()),
      completedAt: e.completedAt ? new Date(e.completedAt.getTime()) : null,
    }))
  }

  // Append-only chronological transition audits logging (Item 10)
  async saveTransition(transition: ActionTransition): Promise<void> {
    const list = this.transitions.get(transition.actionId) ?? []
    const exists = list.some((t) => t.id === transition.id)
    if (exists) {
      throw new Error(`Append-only constraint violation: transition record "${transition.id}" already exists`)
    }

    list.push({
      ...transition,
      timestamp: new Date(transition.timestamp.getTime()),
    })
    this.transitions.set(transition.actionId, list)
  }

  async getTransitionsByAction(actionId: string, workspaceId: WorkspaceId): Promise<ActionTransition[]> {
    const action = await this.getById(actionId)
    if (!action || action.workspaceId !== workspaceId) return []

    const list = this.transitions.get(actionId) ?? []
    return list.map((t) => ({
      ...t,
      timestamp: new Date(t.timestamp.getTime()),
    }))
  }

  // Worker Discover query support (Item 8)
  async getPendingActionsAndWorkspace(workspaceId: WorkspaceId): Promise<Action[]> {
    const list: Action[] = []
    const now = new Date()
    for (const action of this.storage.values()) {
      if (action.workspaceId !== workspaceId) continue

      const isQueuedOrApproved = action.status === 'approved' || action.status === 'queued'

      const isLeaseCleared =
        action.status === 'in-progress' &&
        action.claimedByExecutionId === null &&
        (action.nextAttemptAt === null || action.nextAttemptAt <= now)

      const isLeaseExpired =
        action.status === 'in-progress' &&
        action.leaseExpiresAt !== null &&
        action.leaseExpiresAt <= now

      if (isQueuedOrApproved || isLeaseCleared || isLeaseExpired) {
        const cloned: Action = {
          ...action,
          createdAt: new Date(action.createdAt.getTime()),
          updatedAt: new Date(action.updatedAt.getTime()),
          leaseExpiresAt: action.leaseExpiresAt ? new Date(action.leaseExpiresAt.getTime()) : null,
          nextAttemptAt: action.nextAttemptAt ? new Date(action.nextAttemptAt.getTime()) : null,
        }
        list.push(cloned)
      }
    }
    return list
  }
}

describe('ActionRepository Contract & In-Memory Implementation (2C.4)', () => {
  const repository: ActionRepository = new InMemoryActionRepository()

  const actionA1 = createAction({
    workspaceId: WORKSPACE_A,
    title: 'Action A1',
    description: 'First action for Workspace A',
    target: 'internal',
    status: 'proposed',
    relatedRecommendationId: 'rec-1',
    relatedProposedActionId: 'pa-1',
    externalId: null,
  })

  const actionA2 = createAction({
    workspaceId: WORKSPACE_A,
    title: 'Action A2',
    description: 'Second action for Workspace A',
    target: 'internal',
    status: 'proposed',
    relatedRecommendationId: 'rec-1',
    relatedProposedActionId: 'pa-2',
    externalId: null,
  })

  const actionB1 = createAction({
    workspaceId: WORKSPACE_B,
    title: 'Action B1',
    description: 'Action for Workspace B',
    target: 'internal',
    status: 'proposed',
    relatedRecommendationId: 'rec-2',
    relatedProposedActionId: 'pa-3',
    externalId: null,
  })

  it('1. Save + retrieve by ID and Workspace (Isolation)', async () => {
    await repository.save(actionA1)
    const retrieved = await repository.getByIdAndWorkspace(actionA1.id, WORKSPACE_A)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(actionA1.id)

    // Cross-workspace query returns null
    const crossQuery = await repository.getByIdAndWorkspace(actionA1.id, WORKSPACE_B)
    expect(crossQuery).toBeNull()
  })

  it('2. Retrieve missing ID returns null', async () => {
    const retrieved = await repository.getByIdAndWorkspace('missing-id', WORKSPACE_A)
    expect(retrieved).toBeNull()
  })

  it('3. Save replaces existing ID (Explicit Upsert Semantics)', async () => {
    await repository.save(actionA1)

    const updated = {
      ...actionA1,
      title: 'Action A1 Updated',
      status: 'approved' as const,
      updatedAt: new Date('2026-08-09'),
    }

    await repository.save(updated)
    const retrieved = await repository.getByIdAndWorkspace(actionA1.id, WORKSPACE_A)
    expect(retrieved?.title).toBe('Action A1 Updated')
    expect(retrieved?.status).toBe('approved')
  })

  it('4. getByWorkspace() returns only that workspace (Workspace isolation)', async () => {
    await repository.save(actionA1)
    await repository.save(actionA2)
    await repository.save(actionB1)

    const actionsA = await repository.getByWorkspace({ workspaceId: WORKSPACE_A })
    const actionsB = await repository.getByWorkspace({ workspaceId: WORKSPACE_B })

    expect(actionsA.length).toBe(2)
    expect(actionsA.some((a) => a.id === actionA1.id)).toBe(true)
    expect(actionsA.some((a) => a.id === actionA2.id)).toBe(true)
    expect(actionsA.some((a) => a.id === actionB1.id)).toBe(false)

    expect(actionsB.length).toBe(1)
    expect(actionsB[0].id).toBe(actionB1.id)
  })

  it('5. All Action fields and timestamps survive round-trip', async () => {
    const action = createAction({
      workspaceId: WORKSPACE_A,
      title: 'Smoke Test Action',
      description: 'Detail verification test',
      target: 'github',
      status: 'in-progress',
      relatedRecommendationId: 'rec-smoke-1',
      relatedProposedActionId: 'pa-smoke-2',
      externalId: 'pr-4242',
      createdAt: new Date('2026-08-08T10:00:00.000Z'),
      updatedAt: new Date('2026-08-08T11:00:00.000Z'),
    })

    await repository.save(action)
    const retrieved = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)

    expect(retrieved).toEqual(action)
    expect(retrieved?.createdAt).toEqual(action.createdAt)
    expect(retrieved?.updatedAt).toEqual(action.updatedAt)
    expect(retrieved?.target).toBe('github')
    expect(retrieved?.status).toBe('in-progress')
    expect(retrieved?.externalId).toBe('pr-4242')
  })

  it('6. Two Actions from the same Recommendation are independently retrievable and distinguishable', async () => {
    await repository.save(actionA1)
    await repository.save(actionA2)

    const retrieved1 = await repository.getByIdAndWorkspace(actionA1.id, WORKSPACE_A)
    const retrieved2 = await repository.getByIdAndWorkspace(actionA2.id, WORKSPACE_A)

    expect(retrieved1?.relatedRecommendationId).toBe(retrieved2?.relatedRecommendationId)
    expect(retrieved1?.relatedProposedActionId).not.toEqual(retrieved2?.relatedProposedActionId)
  })

  it('7. Unused workspace has no results', async () => {
    const emptyWorkspace = createWorkspaceId('ws-empty')
    const results = await repository.getByWorkspace({ workspaceId: emptyWorkspace })
    expect(results).toEqual([])
  })

  it('8. Repository does not mutate the Action supplied to it (Immutability check)', async () => {
    const action = createAction(actionA1)
    await repository.save(action)

    const retrieved = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    if (retrieved) {
      retrieved.title = 'Mutated Title'
    }

    const reRetrieved = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(reRetrieved?.title).not.toBe('Mutated Title')
    expect(action.title).not.toBe('Mutated Title')
  })

  it('9. Retrieve by Idempotency Key successfully', async () => {
    await repository.save(actionA1)
    const retrieved = await repository.getByIdempotencyKeyAndWorkspace(actionA1.idempotencyKey, WORKSPACE_A)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(actionA1.id)

    // cross-workspace query returns null
    const cross = await repository.getByIdempotencyKeyAndWorkspace(actionA1.idempotencyKey, WORKSPACE_B)
    expect(cross).toBeNull()
  })

  it('10. Throws Unique Constraint Violation error on duplicate idempotencyKey for different action IDs (Concurrency Safety)', async () => {
    const actionDuplicateKey = createAction({
      workspaceId: WORKSPACE_A,
      title: 'Action Dup Key',
      description: 'Shares key with actionA1',
      target: 'internal',
      status: 'proposed',
      relatedRecommendationId: 'rec-1',
      relatedProposedActionId: 'pa-1',
      externalId: null,
    })

    await repository.save(actionA1)
    await expect(repository.save(actionDuplicateKey)).rejects.toThrow(
      /Unique constraint violation: duplicate idempotencyKey/
    )
  })

  it('11. Atomic lease claiming with crash recovery expiration and previous execution reconciliation', async () => {
    const repositoryWithExec = new InMemoryActionRepository()

    const queuedAction = createAction({
      workspaceId: WORKSPACE_A,
      title: 'Queued Task',
      description: 'Ready to claim',
      target: 'internal',
      status: 'queued',
      relatedRecommendationId: 'rec-1',
      relatedProposedActionId: 'pa-99',
      externalId: null,
    })

    await repositoryWithExec.save(queuedAction)

    // Create a mock previous running execution
    const previousExec = {
      id: 'exec-previous',
      actionId: queuedAction.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'in-progress' as const,
      idempotencyKey: `exec:${queuedAction.id}:1`,
      externalId: null,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    }
    await repositoryWithExec.saveExecution(previousExec)

    // Initial claim succeeds
    const claim1 = await repositoryWithExec.claimForExecution(queuedAction.id, WORKSPACE_A, 'exec-previous', 50) // 50ms lease
    expect(claim1).toBe(true)

    // Parallel claim before lease expiration fails
    const claim2 = await repositoryWithExec.claimForExecution(queuedAction.id, WORKSPACE_A, 'exec-new', 50)
    expect(claim2).toBe(false)

    // Wait for lease to expire
    await new Promise((resolve) => setTimeout(resolve, 60))

    // Reclaim after expiration succeeds and RECONCILES previous execution as failed (Item 1)
    const claim3 = await repositoryWithExec.claimForExecution(queuedAction.id, WORKSPACE_A, 'exec-new', 100)
    expect(claim3).toBe(true)

    // Verify previous execution was reconciled as failed due to lease timeout
    const executions = await repositoryWithExec.getExecutionsByAction(queuedAction.id, WORKSPACE_A)
    const oldExec = executions.find((e) => e.id === 'exec-previous')
    expect(oldExec?.status).toBe('failed')
    expect(oldExec?.error?.code).toBe('timeout')
    expect(oldExec?.error?.retryable).toBe(true)
  })

  it('12. persistExecutionOutcome rejects saves if worker does not own active lease (Lease ownership safety)', async () => {
    const repositoryWithExec = new InMemoryActionRepository()

    const action = createAction({
      workspaceId: WORKSPACE_A,
      title: 'Lease Owner Task',
      description: 'Lease validation test',
      target: 'internal',
      status: 'queued',
      relatedRecommendationId: 'rec-1',
      relatedProposedActionId: 'pa-99',
      externalId: null,
    })
    await repositoryWithExec.save(action)

    // Worker 1 claims action
    await repositoryWithExec.claimForExecution(action.id, WORKSPACE_A, 'exec-worker1', 30) // 30ms lease

    // Wait for lease to expire
    await new Promise((resolve) => setTimeout(resolve, 40))

    // Worker 2 reclaims action
    await repositoryWithExec.claimForExecution(action.id, WORKSPACE_A, 'exec-worker2', 100)

    // Worker 1 tries to persist outcome (must fail because Worker 1 no longer owns active lease)
    const executionWorker1 = {
      id: 'exec-worker1',
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'completed' as const,
      idempotencyKey: `exec:${action.id}:1`,
      externalId: 'ext-999',
      error: null,
      startedAt: new Date(),
      completedAt: new Date(),
    }

    const transition = {
      id: 'trans-1',
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      fromStatus: 'in-progress' as const,
      toStatus: 'completed' as const,
      sequence: 1,
      timestamp: new Date(),
      actor: 'executor',
      reason: 'Success',
    }

    const updatedActionByWorker1 = { ...action, status: 'completed' as const }

    await expect(
      repositoryWithExec.persistExecutionOutcome(updatedActionByWorker1, executionWorker1, transition)
    ).rejects.toThrow(/Lease ownership violation: concurrent worker has taken over/)
  })
})
