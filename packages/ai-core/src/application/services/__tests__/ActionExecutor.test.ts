import { describe, it, expect, beforeEach } from 'vitest'
import { ActionExecutor } from '../ActionExecutor'
import { InMemoryActionRepository } from '../../../domain/repositories/__tests__/ActionRepository.test'
import { createAction } from '../../../domain/entities/Action'
import { adapterRegistry } from '../ActionApplicationService'
import { createWorkspaceId } from '../../../domain/value-objects'
import { GitHubAdapter } from '../adapters/GitHubAdapter'
import { JiraAdapter } from '../adapters/JiraAdapter'

const WORKSPACE_A = createWorkspaceId('ws-executor-a')
const WORKSPACE_B = createWorkspaceId('ws-executor-b')

describe('ActionExecutor — Milestone B: Action Application & Execution Integration Tests', () => {
  let repository: InMemoryActionRepository
  let executor: ActionExecutor
  let githubAdapter: GitHubAdapter
  let jiraAdapter: JiraAdapter

  beforeEach(() => {
    repository = new InMemoryActionRepository()
    executor = new ActionExecutor(repository)
    githubAdapter = new GitHubAdapter()
    jiraAdapter = new JiraAdapter()

    // Clear registry centrally to avoid duplicate registration errors
    adapterRegistry.clear()

    // Register adapters centrally (Item 8)
    adapterRegistry.register(githubAdapter)
    adapterRegistry.register(jiraAdapter)

    // Clear mock server records across runs to ensure test isolation
    GitHubAdapter.resetMockState()
    JiraAdapter.mockExternalIssues.clear()
  })

  const baseInput = {
    workspaceId: WORKSPACE_A,
    title: 'Configure CI',
    description: 'Set up GitHub Action',
    target: 'github' as const,
    status: 'queued' as const, // Must be queued to claim
    relatedRecommendationId: 'rec-123',
    relatedProposedActionId: 'pa-456',
    externalId: null,
  }

  it('1. Normal Success Path: Creates Execution attempt and transitions Action globally to completed', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'gh-valid-token' } }
    const execAttempt = await executor.execute(action.id, WORKSPACE_A, context)

    expect(execAttempt.status).toBe('completed')
    expect(execAttempt.attempt).toBe(1)
    expect(execAttempt.externalId).toContain('gh-issue-')
    expect(execAttempt.completedAt).toBeInstanceOf(Date)

    // Verify Action transitions globally in the repository (Item 6)
    const actionState = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(actionState?.status).toBe('completed')
    expect(actionState?.externalId).toBe(execAttempt.externalId)
    expect(actionState?.claimedByExecutionId).toBeNull()

    // Verify Transition Audit sequence logged (Item 6 & Item 10)
    const transitions = await repository.getTransitionsByAction(action.id, WORKSPACE_A)
    expect(transitions.length).toBe(1)
    expect(transitions[0].fromStatus).toBe('in-progress')
    expect(transitions[0].toStatus).toBe('completed')
    expect(transitions[0].sequence).toBe(1)
    expect(transitions[0].actor).toBe('executor')
  })

  it('2. Transient Error with Retry Policy: Failed attempt #1 keeps Action in-progress; succeeded attempt #2 completes it', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    // Emulate transient Rate Limit error on attempt 1 (Item 8)
    const contextAttempt1 = {
      workspaceId: WORKSPACE_A,
      credentials: { token: 'gh-token', triggerError: '429: Too Many Requests' },
    }
    const attempt1 = await executor.execute(action.id, WORKSPACE_A, contextAttempt1)

    // Verification of attempt 1 failure and retryable state
    expect(attempt1.status).toBe('failed')
    expect(attempt1.error?.code).toBe('rate_limit')
    expect(attempt1.error?.retryable).toBe(true)
    expect(attempt1.error?.retryAfterMs).toBeDefined()

    // Action status must remain in-progress (not failed) to allow retries (Item 1 & Item 4)
    const actionAfterAttempt1 = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(actionAfterAttempt1?.status).toBe('in-progress')
    expect(actionAfterAttempt1?.claimedByExecutionId).toBeNull() // lock cleared for retry

    // Succeeded on attempt 2 (Action is in-progress but can be reclaimed since lease is cleared)
    const contextAttempt2 = { workspaceId: WORKSPACE_A, credentials: { token: 'gh-token' } }
    const attempt2 = await executor.execute(action.id, WORKSPACE_A, contextAttempt2)
    expect(attempt2.status).toBe('completed')
    expect(attempt2.attempt).toBe(2)

    const finalActionState = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(finalActionState?.status).toBe('completed')
    expect(finalActionState?.externalId).toBe(attempt2.externalId)
  })

  it('3. Terminal Failure: Marks Action failed immediately without retrying on unauthorized credentials', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    // Emulate terminal 401 Unauthorized Error (Item 8)
    const context = {
      workspaceId: WORKSPACE_A,
      credentials: { token: 'gh-token', triggerError: '401 Unauthorized: token expired' },
    }
    const attempt = await executor.execute(action.id, WORKSPACE_A, context)

    expect(attempt.status).toBe('failed')
    expect(attempt.error?.code).toBe('authentication')
    expect(attempt.error?.retryable).toBe(false) // terminal

    // Action status must immediately transition globally to failed (Item 4)
    const actionState = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(actionState?.status).toBe('failed')
    expect(actionState?.claimedByExecutionId).toBeNull()

    const transitions = await repository.getTransitionsByAction(action.id, WORKSPACE_A)
    expect(transitions[0].toStatus).toBe('failed')
  })

  it('4. Crash Recovery Reclaim: Reconciles and fails orphaned executions after lease expiration', async () => {
    const action = createAction({
      ...baseInput,
      status: 'in-progress',
      claimedByExecutionId: 'exec-crashed',
    })
    await repository.save(action)

    const crashedExec = {
      id: 'exec-crashed',
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'in-progress' as const,
      idempotencyKey: `exec:${action.id}:1`,
      externalId: null,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    }
    await repository.saveExecution(crashedExec)

    // Mock lease expiration in the past
    action.leaseExpiresAt = new Date(Date.now() - 1000)
    await repository.save(action)

    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'gh-token' } }
    const recoveryAttempt = await executor.execute(action.id, WORKSPACE_A, context)

    // Verify recovery run succeeds
    expect(recoveryAttempt.status).toBe('completed')
    expect(recoveryAttempt.attempt).toBe(2)

    // Verify previously crashed/abandoned Execution was reconciled as failed due to lease timeout (Item 1)
    const executions = await repository.getExecutionsByAction(action.id, WORKSPACE_A)
    const reconciled = executions.find((e) => e.id === 'exec-crashed')
    expect(reconciled?.status).toBe('failed')
    expect(reconciled?.error?.code).toBe('timeout')
    expect(reconciled?.error?.message).toContain('lease expired')
  })

  it('5. Dual-Worker Race Safety: Thread B fails to execute if Action is already claimed by Thread A', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'gh-token' } }

    // Thread A starts execution and successfully acquires claim
    const p1 = executor.execute(action.id, WORKSPACE_A, context)

    // Thread B runs concurrently (or immediately after Thread A claims it)
    const p2 = executor.execute(action.id, WORKSPACE_A, context)

    // Only one thread proceeds; the other fails during claim (Item 2)
    const results = await Promise.allSettled([p1, p2])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason.message).toMatch(
        /Concurrency Lock Failed|Lease ownership violation/
      )
    }
  })

  it('6. Query-Before-Create External Idempotency: Recover from crash after external creation', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    // Attempt 1 creates the PR/Issue on GitHub but crashes before DB commit (External PR is active, DB state out-of-sync)
    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'gh-token' } }

    // Run direct adapter call simulating the crashed worker A side effect (using stable Action idempotency key!) (Item 3 & Item 4)
    const result1 = await githubAdapter.executeAction(action, context, action.idempotencyKey)
    expect(result1.resolution).toBe('created')

    // Retry run triggers. Query-before-create locates the existing PR, reuses its ID, and completed successfully (Item 3)
    const recoveryAttempt = await executor.execute(action.id, WORKSPACE_A, context)
    expect(recoveryAttempt.status).toBe('completed')

    // Confirm that the same exact external ID was reconciled and reused, preventing duplicates (Item 3)
    expect(recoveryAttempt.externalId).toBe(result1.externalId)

    const finalActionState = await repository.getByIdAndWorkspace(action.id, WORKSPACE_A)
    expect(finalActionState?.status).toBe('completed')
  })

  it('7. Cross-Workspace Security Protection: Rejected execution with mismatched tenant workspace Context', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    const context = { workspaceId: WORKSPACE_B, credentials: { token: 'gh-token' } }

    // Trying to execute Action under WORKSPACE_B context must throw authorization error
    await expect(executor.execute(action.id, WORKSPACE_B, context)).rejects.toThrow(
      /Action not found or unauthorized/
    )
  })

  it('8. Complete lease -> crash -> reconciliation -> retry -> success with external idempotency lookup', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    // Worker 1 claims action and writes external side effect but crashes before database commit
    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'gh-valid-token' } }

    // Simulate Worker 1 successful API write on Github mock server (using stable Action idempotency key!) (Item 3 & Item 4)
    const result1 = await githubAdapter.executeAction(action, context, action.idempotencyKey)
    expect(result1.resolution).toBe('created')

    // Simulate Worker 1 crash by having Action stay in in-progress state but with old lease (Item 1)
    action.status = 'in-progress'
    action.claimedByExecutionId = 'exec-worker1'
    action.leaseExpiresAt = new Date(Date.now() - 1000) // expired
    await repository.save(action)

    // Save mock old execution attempt
    const attempt1IdempotencyKey = `exec:${action.id}:1`
    const exec1 = {
      id: 'exec-worker1',
      actionId: action.id,
      workspaceId: WORKSPACE_A,
      attempt: 1,
      status: 'in-progress' as const,
      idempotencyKey: attempt1IdempotencyKey,
      externalId: null,
      error: null,
      startedAt: new Date(),
      completedAt: null,
    }
    await repository.saveExecution(exec1)

    // Worker 2 takes over: triggers execute() which reclaims action and executes cleanly
    const finalAttempt = await executor.execute(action.id, WORKSPACE_A, context)
    expect(finalAttempt.status).toBe('completed')
    expect(finalAttempt.attempt).toBe(2)

    // Verify external ID is successfully recovered and matches Worker 1's side-effect (no duplicate creation!) (Item 3)
    expect(finalAttempt.externalId).toBe(result1.externalId)

    // Verify previously crashed Execution 1 was reconciled as failed (Item 1)
    const executions = await repository.getExecutionsByAction(action.id, WORKSPACE_A)
    const oldExec = executions.find((e) => e.id === 'exec-worker1')
    expect(oldExec?.status).toBe('failed')
    expect(oldExec?.error?.code).toBe('timeout')
  })

  it('9. Credential Redaction Safety: Proves that sensitive keys inside errors are redacted before logs/storage (Item 3 & Item 10)', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    const context = {
      workspaceId: WORKSPACE_A,
      credentials: {
        token: 'secret-token-value',
        triggerError: '401 Unauthorized: token="secret-token-value" failed',
      },
    }
    const attempt = await executor.execute(action.id, WORKSPACE_A, context)

    expect(attempt.status).toBe('failed')
    expect(attempt.error?.message).not.toContain('secret-token-value')
    expect(attempt.error?.message).toContain('[REDACTED]')
  })

  it('10. AdapterRegistry prevents duplicate registrations (Item 12)', () => {
    const dupAdapter = {
      target: 'github' as const,
      validateTarget: async () => {},
      executeAction: async () => ({ externalId: 'pr-99', resolution: 'created' as const }),
    }

    // Attempting to register github target adapter again must throw DuplicateRegistrationError
    expect(() => adapterRegistry.register(dupAdapter)).toThrow(/DuplicateRegistrationError/)
  })

  it('11. Authoritative Timeout: Fails execution attempt if adapter hangs beyond threshold (Item 11)', async () => {
    const action = createAction(baseInput)
    await repository.save(action)

    // Register a hanging adapter
    const hangingAdapter = {
      target: 'slack' as const,
      validateTarget: async () => {},
      executeAction: async () => {
        // Hang indefinitely
        await new Promise(() => {})
        return { externalId: null, resolution: 'created' as const }
      },
    }
    adapterRegistry.register(hangingAdapter)

    const hangingAction = {
      ...action,
      id: 'action-slack-test',
      target: 'slack' as const,
      relatedProposedActionId: 'pa-slack-test',
    }
    hangingAction.idempotencyKey = `promo:${WORKSPACE_A}:${hangingAction.relatedRecommendationId}:pa-slack-test`
    await repository.save(hangingAction)

    // Override timeout limit dynamically to 10ms for fast testing
    const fastExecutor = new ActionExecutor(repository)
    // We override timeout limit to 20ms and lease to 100ms
    Object.defineProperty(fastExecutor, 'executionTimeoutMs', { value: 20 })
    Object.defineProperty(fastExecutor, 'leaseDurationMs', { value: 100 })

    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'slack-token' } }
    const attempt = await fastExecutor.execute(hangingAction.id, WORKSPACE_A, context)

    expect(attempt.status).toBe('failed')
    expect(attempt.error?.code).toBe('timeout')
    expect(attempt.error?.message).toContain('TimeoutError')
  })
})
