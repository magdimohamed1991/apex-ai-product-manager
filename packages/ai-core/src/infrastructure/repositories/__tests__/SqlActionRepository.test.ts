import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../database/DurableFileDatabase'
import { SqlActionRepository } from '../SqlActionRepository'
import { createAction } from '../../../domain/entities/Action'
import { createExecution, createActionTransitionRecord } from '../../../domain/entities'
import type { ActionTransition } from '../../../domain/entities'
import { createWorkspaceId } from '../../../domain/value-objects'

const TEST_DB_DIR = path.join(process.cwd(), 'database-test')
const WORKSPACE_A = createWorkspaceId('ws-sql-a')
const WORKSPACE_B = createWorkspaceId('ws-sql-b')

describe('SqlActionRepository — Milestone D: Real Persistence & Infrastructure Boundary Integration Tests', () => {
  let database: DurableFileDatabase
  let repository: SqlActionRepository

  beforeEach(async () => {
    // Clean database directory before each test case
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }

    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    repository = new SqlActionRepository(database)
  })

  const baseActionInput = {
    workspaceId: WORKSPACE_A,
    title: 'Configure DB schema',
    description: 'Setup Postgres migrations',
    target: 'internal' as const,
    status: 'queued' as const,
    relatedRecommendationId: 'rec-sql-1',
    relatedProposedActionId: 'pa-sql-1',
    externalId: null,
  }

  it('1. Save + retrieve Action, Executions, and Transitions from real durable files', async () => {
    const action = createAction(baseActionInput)
    await repository.save(action)

    // Save Execution Attempt
    const execution = createExecution({
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'completed',
      externalId: 'ext-999',
      error: null,
    })
    await repository.saveExecution(execution)

    // Save Transition Audit Record
    const transition = createActionTransitionRecord({
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      fromStatus: 'queued',
      toStatus: 'in-progress',
      sequence: 1,
      actor: 'executor',
      reason: 'Claimed',
    })
    await repository.saveTransition(transition)

    // Verify retrieval matches perfectly (Survives round-trip, Item 1)
    const retrievedAction = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(retrievedAction).not.toBeNull()
    expect(retrievedAction?.title).toBe('Configure DB schema')

    const retrievedExecutions = await repository.getExecutionsByAction(action.id, WORKSPACE_A)
    expect(retrievedExecutions.length).toBe(1)
    expect(retrievedExecutions[0].externalId).toBe('ext-999')

    const retrievedTransitions = await repository.getTransitionsByAction(action.id, WORKSPACE_A)
    expect(retrievedTransitions.length).toBe(1)
    expect(retrievedTransitions[0].sequence).toBe(1)
  })

  it('2. Enforces UNIQUE(workspace_id, idempotency_key) constraint on Action save', async () => {
    const action1 = createAction(baseActionInput)
    await repository.save(action1)

    // Create Action 2 with a different ID but same idempotencyKey inside WORKSPACE_A
    const action2 = createAction({
      ...baseActionInput,
      id: 'action-colliding-id',
    })

    await expect(repository.save(action2)).rejects.toThrow(
      /Unique constraint violation: duplicate idempotencyKey/
    )
  })

  it('3. Enforces UNIQUE(workspace_id, action_id, sequence) constraint on Transitions (Item 3)', async () => {
    const action = createAction(baseActionInput)
    await repository.save(action)

    const trans1 = createActionTransitionRecord({
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      fromStatus: 'queued',
      toStatus: 'in-progress',
      sequence: 1, // sequence 1
      actor: 'system',
      reason: 'Claimed',
    })
    await repository.saveTransition(trans1)

    const trans2 = createActionTransitionRecord({
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      fromStatus: 'in-progress',
      toStatus: 'completed',
      sequence: 1, // duplicate sequence 1!
      actor: 'executor',
      reason: 'Done',
    })

    await expect(repository.saveTransition(trans2)).rejects.toThrow(
      /Unique constraint violation: duplicate sequence/
    )
  })

  it('4. Enforces Foreign Key constraints: Executions/Transitions require an existing Action (Item 3)', async () => {
    const orphanExec = createExecution({
      actionId: 'nonexistent-action-id',
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'pending',
      externalId: null,
      error: null,
    })

    // Saving execution with non-existent actionId must throw foreign key error
    await expect(repository.saveExecution(orphanExec)).rejects.toThrow(
      /Foreign key constraint violation/
    )
  })

  it('5. Concurrency & Transaction Rollback: Rollback everything on failure, preserving no partial state (Item 5)', async () => {
    const action = createAction(baseActionInput)
    await repository.save(action)

    // Claim Action first so Worker owns the lease
    await repository.claimForExecution(action.id, WORKSPACE_A, 'exec-worker-1', 10000)

    const claimedAction = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    const completedAction = { ...claimedAction!, status: 'completed' as const }

    const execution = createExecution({
      id: 'exec-worker-1', // Match active lease ID! (Item 2)
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'completed',
      externalId: 'ext-999',
      error: null,
    })

    // Create a malformed transition record that will deliberately fail unique constraint checks (sequence < 1)
    const malformedTransition = {
      id: 'trans-malformed',
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      fromStatus: 'in-progress' as const,
      toStatus: 'completed' as const,
      sequence: 0, // Invalid: sequence must be >= 1! (Will trigger a validation error)
      timestamp: new Date(),
      actor: 'executor',
      reason: 'Done',
    }

    // Try to persist outcome atomically.
    // It must trigger rollback during validateTransition() because of sequence constraints,
    // and preserve absolutely no partial state in the DB!
    await expect(
      repository.persistExecutionOutcome(
        completedAction,
        execution,
        malformedTransition as unknown as ActionTransition
      )
    ).rejects.toThrow(/sequence number must be greater than or equal to 1/)

    // Verify Action status remains 'in-progress' (rolled back from completed!)
    const rolledBackAction = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(rolledBackAction?.status).toBe('in-progress')

    // Verify Execution was NOT saved (rolled back!)
    const executions = await repository.getExecutionsByAction(action.id, WORKSPACE_A)
    expect(executions.length).toBe(0)
  })

  it('6. Process Restart Recovery: Schema, retry schedules, leases, and histories survive process restarts (Item 6)', async () => {
    const action = createAction({
      ...baseActionInput,
      status: 'in-progress',
      nextAttemptAt: new Date('2026-08-09T12:00:00.000Z'),
      leaseExpiresAt: new Date('2026-08-09T13:00:00.000Z'),
    })
    await repository.save(action)

    const execution = createExecution({
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'failed',
      externalId: null,
      error: { code: 'timeout', message: 'Timed out', retryable: true, timestamp: new Date() },
    })
    await repository.saveExecution(execution)

    // Simulate process shutdown/restart: Instatitate a fresh DB and repository pointing to the same file
    const restartedDatabase = new DurableFileDatabase(TEST_DB_DIR)
    await restartedDatabase.initialize()
    const restartedRepository = new SqlActionRepository(restartedDatabase)

    // Verify that Action states and histories survive restart completely intact! (Item 6)
    const restoredAction = await restartedRepository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(restoredAction).not.toBeNull()
    expect(restoredAction?.status).toBe('in-progress')
    expect(restoredAction?.nextAttemptAt).toEqual(action.nextAttemptAt)
    expect(restoredAction?.leaseExpiresAt).toEqual(action.leaseExpiresAt)

    const restoredExecutions = await restartedRepository.getExecutionsByAction(
      action.id,
      WORKSPACE_A
    )
    expect(restoredExecutions.length).toBe(1)
    expect(restoredExecutions[0].error?.code).toBe('timeout')
  })

  it('7. Multi-Tenant Security & Isolation Matrix: Rejects any cross-workspace lookups or leaks (Item 8)', async () => {
    const action = createAction(baseActionInput)
    await repository.save(action)

    // Save Execution under Workspace A
    const execution = createExecution({
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'completed',
      externalId: 'ext-999',
      error: null,
    })
    await repository.saveExecution(execution)

    // Save Transition under Workspace A
    const transition = createActionTransitionRecord({
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      fromStatus: 'queued',
      toStatus: 'in-progress',
      sequence: 1,
      actor: 'executor',
      reason: 'Claimed',
    })
    await repository.saveTransition(transition)

    // Assert absolute security isolation for Workspace B queries:
    // Guessed action IDs or keys must never cross boundaries!
    expect(await repository.getByIdAndWorkspace(action.id, WORKSPACE_B)).toBeNull()
    expect(
      await repository.getByIdempotencyKeyAndWorkspace(action.idempotencyKey, WORKSPACE_B)
    ).toBeNull()
    expect(await repository.getByWorkspace({ workspaceId: WORKSPACE_B })).toEqual([])
    expect(await repository.getExecutionsByAction(action.id, WORKSPACE_B)).toEqual([])
    expect(await repository.getTransitionsByAction(action.id, WORKSPACE_B)).toEqual([])
  })

  it('8. Cross-workspace same-id Action/Execution upserts never clobber the other tenant row', async () => {
    // Regression for the audit finding: the DB layer previously upserted by
    // `id` alone, so a same-id row from workspace B would REPLACE workspace
    // A's row. The upsert must be scoped by (id, workspaceId).
    const actionA = createAction({
      ...baseActionInput,
      id: 'action-shared-id',
      workspaceId: WORKSPACE_A,
      relatedRecommendationId: 'rec-shared-a',
      relatedProposedActionId: 'pa-shared-a',
    })
    await repository.save(actionA)

    const actionB = createAction({
      ...baseActionInput,
      id: 'action-shared-id',
      workspaceId: WORKSPACE_B,
      relatedRecommendationId: 'rec-shared-b',
      relatedProposedActionId: 'pa-shared-b',
    })
    await repository.save(actionB)

    // Both rows survive; each tenant sees its own.
    const fetchedA = await repository.getByIdAndWorkspace('action-shared-id', WORKSPACE_A)
    const fetchedB = await repository.getByIdAndWorkspace('action-shared-id', WORKSPACE_B)
    expect(fetchedA?.relatedRecommendationId).toBe('rec-shared-a')
    expect(fetchedB?.relatedRecommendationId).toBe('rec-shared-b')

    // Same for executions: same execution id in both workspaces.
    const execA = createExecution({
      id: 'exec-shared-id',
      actionId: actionA.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'completed',
      externalId: 'ext-a',
      error: null,
    })
    await repository.saveExecution(execA)
    const execB = createExecution({
      id: 'exec-shared-id',
      actionId: actionB.id,
      workspaceId: WORKSPACE_B,
      attempt: 1,
      status: 'failed',
      externalId: null,
      error: { code: 'unknown', message: 'x', retryable: false, timestamp: new Date() },
    })
    await repository.saveExecution(execB)

    const execsA = await repository.getExecutionsByAction(actionA.id, WORKSPACE_A)
    const execsB = await repository.getExecutionsByAction(actionB.id, WORKSPACE_B)
    expect(execsA).toHaveLength(1)
    expect(execsA[0].externalId).toBe('ext-a')
    expect(execsB).toHaveLength(1)
    expect(execsB[0].status).toBe('failed')
  })
})
