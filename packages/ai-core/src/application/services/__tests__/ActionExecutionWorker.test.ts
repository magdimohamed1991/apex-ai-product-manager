import { describe, it, expect, beforeEach } from 'vitest'
import { ActionExecutionWorker } from '../ActionExecutionWorker'
import { ActionExecutor } from '../ActionExecutor'
import { InMemoryActionRepository } from '../../../domain/repositories/__tests__/ActionRepository.test'
import { createAction } from '../../../domain/entities/Action'
import { adapterRegistry } from '../ActionApplicationService'
import { createWorkspaceId } from '../../../domain/value-objects'
import { GitHubAdapter } from '../adapters/GitHubAdapter'

const WORKSPACE_A = createWorkspaceId('ws-worker-test-a')

describe('ActionExecutionWorker — Milestone C: Worker Polling & Background Discovery', () => {
  let repository: InMemoryActionRepository
  let executor: ActionExecutor
  let worker: ActionExecutionWorker
  let githubAdapter: GitHubAdapter

  beforeEach(() => {
    repository = new InMemoryActionRepository()
    executor = new ActionExecutor(repository)
    worker = new ActionExecutionWorker(repository, executor)
    githubAdapter = new GitHubAdapter()

    adapterRegistry.clear()
    adapterRegistry.register(githubAdapter)
    GitHubAdapter.mockExternalIssues.clear()
  })

  const baseInput = {
    workspaceId: WORKSPACE_A,
    title: 'Setup CI/CD',
    description: 'Add workflows',
    target: 'github' as const,
    status: 'queued' as const,
    relatedRecommendationId: 'rec-123',
    relatedProposedActionId: 'pa-456',
    externalId: null,
  }

  it('1. Discover and process approved and queued Actions successfully', async () => {
    const action1 = createAction({ ...baseInput, relatedProposedActionId: 'pa-1' })
    const action2 = createAction({ ...baseInput, relatedProposedActionId: 'pa-2' })
    await repository.save(action1)
    await repository.save(action2)

    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'valid-token' } }
    const processed = await worker.processPendingActions(WORKSPACE_A, context)

    expect(processed.length).toBe(2)
    expect(processed.every((a) => a.status === 'completed')).toBe(true)
  })

  it('2. Discovers and retries ready (elapsed) Actions but ignores active/future nextAttemptAt Actions', async () => {
    const now = Date.now()

    // Action A: retry delay has passed (Ready for retry)
    const actionA = createAction({
      ...baseInput,
      status: 'in-progress',
      relatedProposedActionId: 'pa-ready',
      nextAttemptAt: new Date(now - 1000), // delay in past
    })

    // Action B: retry delay is in the future (Should be skipped)
    const actionB = createAction({
      ...baseInput,
      status: 'in-progress',
      relatedProposedActionId: 'pa-future',
      nextAttemptAt: new Date(now + 10000), // delay in future
    })

    await repository.save(actionA)
    await repository.save(actionB)

    const context = { workspaceId: WORKSPACE_A, credentials: { token: 'valid-token' } }
    
    // Discover ready actions
    const discoverable = await repository.getPendingActionsAndWorkspace(WORKSPACE_A)
    expect(discoverable.length).toBe(1)
    expect(discoverable[0].relatedProposedActionId).toBe('pa-ready')

    // Worker process
    const processed = await worker.processPendingActions(WORKSPACE_A, context)
    expect(processed.length).toBe(1)
    expect(processed[0].relatedProposedActionId).toBe('pa-ready')
  })
})
