import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { ActionApplicationService, adapterRegistry } from '../ActionApplicationService'
import { ActionExecutor } from '../ActionExecutor'
import { ActionExecutionWorker } from '../ActionExecutionWorker'
import { RepositoryDiscoveryPipeline } from '../../../intelligence/pipeline/RepositoryDiscoveryPipeline'
import { PipelineActionOrchestrator } from '../PipelineActionOrchestrator'
import { EnvCredentialProvider } from '../CredentialProvider'
import { APEXProductService } from '../APEXProductService'
import { ProductIntelligenceService } from '../ProductIntelligenceService'
import { RecommendationOutcomeService } from '../RecommendationOutcomeService'
import { createWorkspaceId } from '../../../domain/value-objects'
import { GitHubAdapter } from '../adapters/GitHubAdapter'

const TEST_DB_DIR = path.join(process.cwd(), 'database-walking-skeleton-test')
const WORKSPACE_A = createWorkspaceId('ws-skele-a')
const WORKSPACE_B = createWorkspaceId('ws-skele-b')

describe('Milestone G — APEX Vertical Walking Skeleton Integration Tests', () => {
  let database: DurableFileDatabase
  let actionRepository: SqlActionRepository
  let productRepository: SqlProductRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let actionAppService: ActionApplicationService
  let pipeline: RepositoryDiscoveryPipeline
  let orchestrator: PipelineActionOrchestrator
  let credentialProvider: EnvCredentialProvider
  let outcomeService: RecommendationOutcomeService
  let productService: APEXProductService
  let executor: ActionExecutor
  let worker: ActionExecutionWorker
  let githubAdapter: GitHubAdapter

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }

    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    actionRepository = new SqlActionRepository(database)
    productRepository = new SqlProductRepository(database)
    outcomeRepository = new SqlRecommendationOutcomeRepository(database)
    actionAppService = new ActionApplicationService(actionRepository)
    pipeline = new RepositoryDiscoveryPipeline()
    orchestrator = new PipelineActionOrchestrator(pipeline, actionAppService)
    credentialProvider = new EnvCredentialProvider()
    outcomeService = new RecommendationOutcomeService(
      outcomeRepository,
      productRepository,
      actionRepository
    )

    productService = new APEXProductService(
      productRepository,
      actionRepository,
      actionAppService,
      orchestrator,
      credentialProvider,
      new ProductIntelligenceService(),
      outcomeService
    )

    executor = new ActionExecutor(actionRepository)
    worker = new ActionExecutionWorker(actionRepository, executor)
    githubAdapter = new GitHubAdapter()

    adapterRegistry.clear()
    adapterRegistry.register(githubAdapter)
    GitHubAdapter.resetMockState()
  })

  describe('1. The Happy Path User Journey (Item 2 & Item 17)', () => {
    it('traverses workspace, project, connection, analysis, approval, and execution flawlessly', async () => {
      // 1. Create Workspace
      const ws = await productService.createWorkspace('ws-skele-a', 'Acme Corporation', 'acme')
      expect(ws.id).toBe(WORKSPACE_A)

      // 2. Create Project
      const proj = await productService.createProject('ws-skele-a', 'proj-1', 'Apex Product Core')
      expect(proj.id).toBe('proj-1')

      // 3. Connect Repository (Item 4)
      const conn = await productService.connectRepository('ws-skele-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager', // Scans real files locally!
        defaultBranch: 'main',
      })
      expect(conn.status).toBe('connected')

      // 4. Run Discovery & Analysis (Item 6, Item 7 & Item 8)
      const run = await productService.runAnalysis('ws-skele-a', 'proj-1')
      expect(run.status).toBe('completed')
      expect(run.projectId).toBe('proj-1')

      // 5. Inspect Findings and Recommendations (Item 9)
      const findings = await productService.getFindings('ws-skele-a', 'proj-1')
      const recommendations = await productService.getRecommendations('ws-skele-a', 'proj-1')

      expect(findings.length).toBeGreaterThanOrEqual(0)
      expect(recommendations.length).toBeGreaterThan(0)

      const rec = recommendations[0]
      expect(rec.proposedActions.length).toBeGreaterThan(0)
      const pa = rec.proposedActions[0]

      // 6. User Reviews & Approves Action (Item 10)
      const action = await productService.approveAction('ws-skele-a', 'proj-1', rec.id, pa.id)
      expect(action.status).toBe('approved')
      expect(action.target).toBe('github')

      // 7. Background Worker Polls and Executes Action (Item 11, Item 12 & Item 13)
      const creds = await credentialProvider.getCredentials(WORKSPACE_A, 'github')
      const context = { workspaceId: WORKSPACE_A, credentials: { token: creds.token } }

      const processed = await worker.processPendingActions(WORKSPACE_A, context)
      expect(processed.length).toBe(1)
      expect(processed[0].status).toBe('completed')
      expect(processed[0].externalId).toContain('gh-issue-')

      // 8. Observe Activity timeline (Item 14)
      const activity = await productService.getActivityLog('ws-skele-a', 'proj-1')
      expect(activity.length).toBeGreaterThan(0)

      // Trace lineage runId -> recommendationId -> proposedActionId -> actionId -> externalId (Item 20)
      const pipelineRunEvent = activity.find((a) => a.type === 'pipeline')
      expect(pipelineRunEvent?.metadata?.runId).toBe(run.id)

      const executionEvent = activity.find((a) => a.type === 'execution')
      expect(executionEvent?.metadata?.actionId).toBe(action.id)
      expect(executionEvent?.metadata?.externalId).toBe(processed[0].externalId)
    })
  })

  describe('2. Repeatable Analysis & End-to-End Idempotency (Item 7 & Item 17)', () => {
    it('running the analysis twice does not create duplicate findings or actions', async () => {
      await productService.createWorkspace('ws-skele-a', 'Acme', 'acme')
      await productService.createProject('ws-skele-a', 'proj-1', 'Apex Core')
      await productService.connectRepository('ws-skele-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      })

      // Run Analysis 1
      await productService.runAnalysis('ws-skele-a', 'proj-1')
      const recs1 = await productService.getRecommendations('ws-skele-a', 'proj-1')
      const rec = recs1[0]
      const pa = rec.proposedActions[0]

      // Approve and Promote Action
      const action1 = await productService.approveAction('ws-skele-a', 'proj-1', rec.id, pa.id)

      // Run Analysis 2
      await productService.runAnalysis('ws-skele-a', 'proj-1')
      const recs2 = await productService.getRecommendations('ws-skele-a', 'proj-1')

      // Same number of recommendations (no duplication)
      expect(recs2.length).toBe(recs1.length)

      // Approve Action again (should return identical promoted action with zero duplication)
      const action2 = await productService.approveAction('ws-skele-a', 'proj-1', rec.id, pa.id)
      expect(action2.id).toBe(action1.id)

      const actionsInWorkspace = await actionRepository.getByWorkspace({ workspaceId: WORKSPACE_A })
      const expectedCount = recs1.reduce((sum, r) => sum + r.proposedActions.length, 0)
      expect(actionsInWorkspace.length).toBe(expectedCount) // All proposed actions promoted, 0 duplicates on second run
    })
  })

  describe('3. Multi-Tenant Workspace Security Segregation (Item 16 & Item 17)', () => {
    it('guarantees tenant isolation so Workspace B cannot view, edit, or execute Workspace A items', async () => {
      // Setup Workspace A
      await productService.createWorkspace('ws-skele-a', 'Acme A', 'acme-a')
      await productService.createProject('ws-skele-a', 'proj-a', 'Project A')
      await productService.connectRepository('ws-skele-a', 'proj-a', {
        provider: 'github',
        owner: 'acme-a',
        repository: 'apex',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-skele-a', 'proj-a')
      const recsA = await productService.getRecommendations('ws-skele-a', 'proj-a')
      const recA = recsA[0]
      const actionA = await productService.approveAction(
        'ws-skele-a',
        'proj-a',
        recA.id,
        recA.proposedActions[0].id
      )

      // Setup Workspace B
      await productService.createWorkspace('ws-skele-b', 'Acme B', 'acme-b')

      // 1. Workspace B cannot access Workspace A's Project
      const projB = await productRepository.getProjectByIdAndWorkspace('proj-a', WORKSPACE_B)
      expect(projB).toBeNull()

      // 2. Workspace B cannot access Workspace A's Connection
      const connB = await productRepository.getRepositoryConnectionByProject('proj-a', WORKSPACE_B)
      expect(connB).toBeNull()

      // 3. Workspace B cannot access Workspace A's Recommendations or Findings
      const recsB = await productService.getRecommendations('ws-skele-b', 'proj-a')
      expect(recsB).toEqual([])

      const findingsB = await productService.getFindings('ws-skele-b', 'proj-a')
      expect(findingsB).toEqual([])

      // 4. Workspace B cannot approve Workspace A's Proposed Action
      await expect(
        productService.approveAction('ws-skele-b', 'proj-a', recA.id, recA.proposedActions[0].id)
      ).rejects.toThrow()

      // 5. Workspace B cannot claim or execute Workspace A's Action
      const claimB = await actionRepository.claimForExecution(
        actionA.id,
        WORKSPACE_B,
        'exec-b',
        5000
      )
      expect(claimB).toBe(false)
    })
  })

  describe('4. Process Restart Resilience (Item 15 & Item 17)', () => {
    it('queued or retry actions survive process crashes and can be claimed directly by the background worker', async () => {
      await productService.createWorkspace('ws-skele-a', 'Acme', 'acme')
      await productService.createProject('ws-skele-a', 'proj-1', 'Project')
      await productService.connectRepository('ws-skele-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-skele-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-skele-a', 'proj-1')
      const action = await productService.approveAction(
        'ws-skele-a',
        'proj-1',
        recs[0].id,
        recs[0].proposedActions[0].id
      )

      // Simulate Process Restart: instantiate completely fresh database connection pointing to the same folder
      const restartedDatabase = new DurableFileDatabase(TEST_DB_DIR)
      await restartedDatabase.initialize()
      const restartedActionRepository = new SqlActionRepository(restartedDatabase)
      const restartedExecutor = new ActionExecutor(restartedActionRepository)
      const restartedWorker = new ActionExecutionWorker(
        restartedActionRepository,
        restartedExecutor
      )

      // Worker discovers, claims, and processes without rerunning analysis
      const creds = await credentialProvider.getCredentials(WORKSPACE_A, 'github')
      const context = { workspaceId: WORKSPACE_A, credentials: { token: creds.token } }
      const processed = await restartedWorker.processPendingActions(WORKSPACE_A, context)

      expect(processed.length).toBe(1)
      expect(processed[0].id).toBe(action.id)
      expect(processed[0].status).toBe('completed')
    })
  })

  describe('5. Integration Failure Scenarios (Item 17)', () => {
    it('schedules a retry with exponential backoff on transient errors (Rate Limit 429)', async () => {
      await productService.createWorkspace('ws-skele-a', 'Acme', 'acme')
      await productService.createProject('ws-skele-a', 'proj-1', 'Project')
      await productService.connectRepository('ws-skele-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-skele-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-skele-a', 'proj-1')
      const action = await productService.approveAction(
        'ws-skele-a',
        'proj-1',
        recs[0].id,
        recs[0].proposedActions[0].id
      )

      // Execute with transient error credentials
      const context = {
        workspaceId: WORKSPACE_A,
        credentials: { token: 'valid-token', triggerError: 'Rate Limit 429' },
      }

      const processed = await worker.processPendingActions(WORKSPACE_A, context)
      expect(processed.length).toBe(1)

      // Action remains in-progress for scheduling retry
      expect(processed[0].status).toBe('in-progress')
      expect(processed[0].nextAttemptAt).not.toBeNull()

      const executions = await actionRepository.getExecutionsByAction(action.id, WORKSPACE_A)
      expect(executions[0].status).toBe('failed')
      expect(executions[0].error?.code).toBe('rate_limit')
    })

    it('transitions to terminal failed state on authentication failures (401 Unauthorized)', async () => {
      await productService.createWorkspace('ws-skele-a', 'Acme', 'acme')
      await productService.createProject('ws-skele-a', 'proj-1', 'Project')
      await productService.connectRepository('ws-skele-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-skele-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-skele-a', 'proj-1')
      const action = await productService.approveAction(
        'ws-skele-a',
        'proj-1',
        recs[0].id,
        recs[0].proposedActions[0].id
      )

      // Execute with authentication failure credentials
      const context = {
        workspaceId: WORKSPACE_A,
        credentials: {
          token: 'bad-token',
          triggerError: '401 Unauthorized: GitHub access token is invalid',
        },
      }

      const processed = await worker.processPendingActions(WORKSPACE_A, context)
      expect(processed.length).toBe(1)

      // Action transitions immediately to failed terminal state (no retry)
      expect(processed[0].status).toBe('failed')
      expect(processed[0].nextAttemptAt).toBeNull()

      const executions = await actionRepository.getExecutionsByAction(action.id, WORKSPACE_A)
      expect(executions[0].status).toBe('failed')
      expect(executions[0].error?.code).toBe('authentication')
    })
  })

  describe('6. Crash Recovery & Execution Idempotency (Item 17)', () => {
    it('recovers safely using query-before-create without creating a duplicate GitHub issue', async () => {
      await productService.createWorkspace('ws-skele-a', 'Acme', 'acme')
      await productService.createProject('ws-skele-a', 'proj-1', 'Project')
      await productService.connectRepository('ws-skele-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-skele-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-skele-a', 'proj-1')
      const action = await productService.approveAction(
        'ws-skele-a',
        'proj-1',
        recs[0].id,
        recs[0].proposedActions[0].id
      )

      // Step 1: Simulate worker crash. Worker started the issue creation on GitHub, issue was created on GitHub, but worker crashed and terminated before saving back to database.
      const context = { workspaceId: WORKSPACE_A, credentials: { token: 'valid-token' } }
      const expectedIdempotencyKey = action.idempotencyKey

      const result1 = await githubAdapter.executeAction(action, context, expectedIdempotencyKey)
      expect(result1.resolution).toBe('created')

      // State in DB remains approved/queued
      const liveAction = await actionRepository.getByIdAndWorkspace(action.id, WORKSPACE_A)
      expect(liveAction?.status).toBe('approved')

      // Step 2: Restart and process (Reconciliation!). Worker queries GitHub using query-before-create, retrieves existing issue, and completes without double issue creation.
      const processed = await worker.processPendingActions(WORKSPACE_A, context)
      expect(processed.length).toBe(1)
      expect(processed[0].status).toBe('completed')
      expect(processed[0].externalId).toBe(result1.externalId)
    })
  })
})
