import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { ActionExecutor } from '../ActionExecutor'
import { adapterRegistry, redactSensitiveData } from '../ActionApplicationService'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { createAction, transitionAction } from '../../../domain/entities/Action'
import { createExecution, createActionTransitionRecord } from '../../../domain/entities'
import { createWorkspaceId } from '../../../domain/value-objects'
import { GitHubAdapter } from '../adapters/GitHubAdapter'

const TEST_DB_DIR = path.join(process.cwd(), 'database-milestoneF')
const WORKSPACE_A = createWorkspaceId('ws-milestoneF-a')
const WORKSPACE_B = createWorkspaceId('ws-milestoneF-b')

describe('Milestone F — End-to-End Hardening & Production Readiness Test Matrix', () => {
  let database: DurableFileDatabase
  let repository: SqlActionRepository
  let githubAdapter: GitHubAdapter

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }

    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    repository = new SqlActionRepository(database)
    githubAdapter = new GitHubAdapter()

    adapterRegistry.clear()
    adapterRegistry.register(githubAdapter)
    GitHubAdapter.resetMockState()
  })

  const baseInput = {
    workspaceId: WORKSPACE_A,
    title: 'Configure CI/CD',
    description: 'Set up GitHub workflows',
    target: 'github' as const,
    status: 'queued' as const,
    relatedRecommendationId: 'rec-123',
    relatedProposedActionId: 'pa-456',
    externalId: null,
  }

  describe('1. Concurrency, Race Conditions, and Stale-Worker Protection', () => {
    it('Scenario 1.1: Thread B fails to claim action if Thread A has an active lease claim', async () => {
      const action = createAction(baseInput)
      await repository.save(action)

      // Thread A claims action
      const claimA = await repository.claimForExecution(
        action.id,
        WORKSPACE_A,
        'exec-worker-A',
        5000
      )
      expect(claimA).toBe(true)

      // Thread B tries to claim concurrently (must fail because Thread A owns an active lease) (Item 2)
      const claimB = await repository.claimForExecution(
        action.id,
        WORKSPACE_A,
        'exec-worker-B',
        5000
      )
      expect(claimB).toBe(false)
    })

    it('Scenario 1.2: Stale worker outcome persistence is blocked after lease expiration takeover (Item 2)', async () => {
      const action = createAction(baseInput)
      await repository.save(action)

      // Worker 1 claims action with a very short lease (10ms)
      await repository.claimForExecution(action.id, WORKSPACE_A, 'exec-worker-1', 10)

      // Wait for Worker 1 lease to expire
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Worker 2 takes over and claims Action (reconciling Worker 1)
      const claimWorker2 = await repository.claimForExecution(
        action.id,
        WORKSPACE_A,
        'exec-worker-2',
        10000
      )
      expect(claimWorker2).toBe(true)

      // Worker 1 finishes its late side-effect and attempts to save (must fail with lease ownership violation!)
      const executionWorker1 = createExecution({
        id: 'exec-worker-1',
        actionId: action.id,
        workspaceId: WORKSPACE_A,
        attempt: 1,
        status: 'completed',
        externalId: 'gh-issue-111',
        error: null,
      })

      const transition = createActionTransitionRecord({
        actionId: action.id,
        workspaceId: WORKSPACE_A,
        fromStatus: 'in-progress',
        toStatus: 'completed',
        sequence: 1,
        actor: 'executor',
        reason: 'Late success',
      })

      const completedAction = {
        ...action,
        status: 'completed' as const,
        externalId: 'gh-issue-111',
      }

      await expect(
        repository.persistExecutionOutcome(completedAction, executionWorker1, transition)
      ).rejects.toThrow(/Lease ownership violation: concurrent worker has taken over/)
    })
  })

  describe('2. Durable State, Process Restarts, and Crashes', () => {
    it('Scenario 2.1: Crash after external creation recovers safely on retry without duplicates (Item 3 & Item 6)', async () => {
      const action = createAction(baseInput)
      await repository.save(action)

      // Worker 1 starts, creates a PR on GitHub, but crashes before saving back to database
      const context = { workspaceId: WORKSPACE_A, credentials: { token: 'valid-token' } }
      const attempt1IdempotencyKey = action.idempotencyKey
      const result1 = await githubAdapter.executeAction(action, context, attempt1IdempotencyKey)
      expect(result1.resolution).toBe('created')

      // Process restart: Instatitate fresh repository and executor pointing to same file
      const restartedDatabase = new DurableFileDatabase(TEST_DB_DIR)
      await restartedDatabase.initialize()
      const restartedRepository = new SqlActionRepository(restartedDatabase)
      const restartedExecutor = new ActionExecutor(restartedRepository)

      // Retry run (Attempt 2): Query-before-create locates the issue and recovers cleanly
      const attempt2 = await restartedExecutor.execute(action.id, WORKSPACE_A, context)
      expect(attempt2.status).toBe('completed')
      expect(attempt2.attempt).toBe(1) // first DB attempt logged, but handles reconciliation
      expect(attempt2.externalId).toBe(result1.externalId) // Reuses existing external ID! (No duplicates!)
    })
  })

  describe('3. Multi-Tenant Security & Workspace Isolation Matrix (Item 8 & Item 12)', () => {
    it('Scenario 3.1: Enforces workspace tenant isolation across every single repository operation', async () => {
      const action = createAction(baseInput)
      await repository.save(action)

      // Workspace B must NEVER be able to read, write, claim, or interact with Workspace A actions (Security matrix)
      expect(await repository.getByIdAndWorkspace(action.id, WORKSPACE_B)).toBeNull()
      expect(
        await repository.getByIdempotencyKeyAndWorkspace(action.idempotencyKey, WORKSPACE_B)
      ).toBeNull()
      expect(await repository.getByWorkspace({ workspaceId: WORKSPACE_B })).toEqual([])
      expect(await repository.getExecutionsByAction(action.id, WORKSPACE_B)).toEqual([])
      expect(await repository.getTransitionsByAction(action.id, WORKSPACE_B)).toEqual([])

      const claimB = await repository.claimForExecution(action.id, WORKSPACE_B, 'exec-b', 5000)
      expect(claimB).toBe(false)
    })
  })

  describe('4. Credentials Sanitization & Redaction (Item 3 & Item 10)', () => {
    it('Scenario 4.1: Recursively sweeps and redacts OAuth tokens and API keys nested deep inside logs/metadata', () => {
      const leakPayload = {
        title: 'Issue',
        credentials: {
          token: 'oauth-token-12345',
          apiKey: 'key-abcde',
        },
        error: {
          message: 'Failed: Bearer secret-token-value',
        },
        nestedList: [{ password: 'raw-password' }],
      }

      const sanitized = redactSensitiveData(leakPayload) as {
        credentials: unknown
        error: { message: string }
        nestedList: Array<{ password: string }>
      }

      expect(sanitized.credentials).toBe('[REDACTED]')
      expect(sanitized.error.message).toContain('[REDACTED]')
      expect(sanitized.nestedList[0].password).toBe('[REDACTED]')
    })
  })

  describe('5. Actor Authority state transitions (Item 5)', () => {
    it('Scenario 5.1: Enforces transition actors: rejects user or unauthorized actor status changes', () => {
      const action = createAction({ ...baseInput, status: 'proposed' }) // proposed -> approved

      // proposed -> approved is authorized for 'user' or 'system'
      const approved = transitionAction(action, 'approved', 'user')
      expect(approved.status).toBe('approved')

      // approved -> queued is authorized for 'system' only
      const queued = transitionAction(approved, 'queued', 'system')
      expect(queued.status).toBe('queued')

      // queued -> in-progress is NOT authorized for 'user' (must fail!)
      expect(() => transitionAction(queued, 'in-progress', 'user')).toThrow(
        /rejected: actor "user" is not authorized/
      )
    })
  })
})
