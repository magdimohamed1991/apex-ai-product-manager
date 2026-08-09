import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { ActionApplicationService, adapterRegistry } from '../ActionApplicationService'
import { RepositoryDiscoveryPipeline } from '../../../intelligence/pipeline/RepositoryDiscoveryPipeline'
import { PipelineActionOrchestrator } from '../PipelineActionOrchestrator'
import { EnvCredentialProvider } from '../CredentialProvider'
import { APEXProductService } from '../APEXProductService'
import { ProductIntelligenceService } from '../ProductIntelligenceService'
import { RecommendationOutcomeService } from '../RecommendationOutcomeService'
import { createWorkspaceId } from '../../../domain/value-objects'
import { GitHubAdapter } from '../adapters/GitHubAdapter'

const TEST_DB_DIR = path.join(process.cwd(), 'database-outcome-test')
const WORKSPACE_B = createWorkspaceId('ws-outcome-b')

describe('Milestone H5 — Product Decision Validation Tests', () => {
  let database: DurableFileDatabase
  let actionRepository: SqlActionRepository
  let productRepository: SqlProductRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let actionAppService: ActionApplicationService
  let pipeline: RepositoryDiscoveryPipeline
  let orchestrator: PipelineActionOrchestrator
  let credentialProvider: EnvCredentialProvider
  let intelligenceService: ProductIntelligenceService
  let outcomeService: RecommendationOutcomeService
  let productService: APEXProductService
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
    intelligenceService = new ProductIntelligenceService()
    
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
      intelligenceService,
      outcomeService
    )

    githubAdapter = new GitHubAdapter()
    adapterRegistry.clear()
    adapterRegistry.register(githubAdapter)
    GitHubAdapter.mockExternalIssues.clear()
  })

  describe('1. Closed-Loop Outcome Verification (Item 3 & Item 4)', () => {
    it('successfully tracks, rescans, and verifies the resolution of Vitest recommendation', async () => {
      // Setup Project
      await productService.createWorkspace('ws-outcome-a', 'Acme', 'acme')
      await productService.createProject('ws-outcome-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-outcome-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex', // Mock fallback triggered (No tests, no CI)
        defaultBranch: 'main',
      })

      // 1. Run Initial scan to generate "Introduce automated testing"
      await productService.runAnalysis('ws-outcome-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-outcome-a', 'proj-1')
      const testRec = recs.find((r) => r.title.toLowerCase().includes('test'))!
      const pa = testRec.proposedActions[0]

      // 2. PM Approves & Promotes Action
      const action = await productService.approveAction('ws-outcome-a', 'proj-1', testRec.id, pa.id)
      expect(action.status).toBe('approved')

      // 3. Create initial pending outcome track record
      const outcome = await productService.createOutcome(testRec.id, 'ws-outcome-a', 'proj-1', action.id)
      expect(outcome.status).toBe('PENDING')

      // 4. Code changes happen (Vitest config is introduced in the repo)
      const filesAfterChange = {
        url: 'https://github.com/acme/apex',
        hasVitestConfig: true, // Vitest introduced! (Item 2)
        fileList: ['package.json', 'vitest.config.ts'],
      }

      // 5. APEX rescans and verifies codebase state changes
      const verified = await productService.verifyOutcome(outcome.id, 'ws-outcome-a', filesAfterChange)
      
      expect(verified.status).toBe('VERIFIED_SUCCESS') // Loop successfully closed! (Item 3 & Item 4)
      expect(verified.resolvedAt).not.toBeNull()
      expect(verified.verificationEvidence[0]).toContain('Detected vitest.config.ts')
    })

    it('returns FAILED if codebase remains unconfigured', async () => {
      await productService.createWorkspace('ws-outcome-a', 'Acme', 'acme')
      await productService.createProject('ws-outcome-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-outcome-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex',
        defaultBranch: 'main',
      })

      await productService.runAnalysis('ws-outcome-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-outcome-a', 'proj-1')
      const testRec = recs.find((r) => r.title.toLowerCase().includes('test'))!

      const outcome = await productService.createOutcome(testRec.id, 'ws-outcome-a', 'proj-1')
      
      const filesAfterChange = {
        url: 'https://github.com/acme/apex',
        hasVitestConfig: false, // Remains unconfigured
      }

      const verified = await productService.verifyOutcome(outcome.id, 'ws-outcome-a', filesAfterChange)
      expect(verified.status).toBe('FAILED')
    })
  })

  describe('2. Decision-Quality Metrics (Item 6)', () => {
    it('aggregates precise acceptance, false positive, and success metrics for project PM decisions', async () => {
      await productService.createWorkspace('ws-outcome-a', 'Acme', 'acme')
      await productService.createProject('ws-outcome-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-outcome-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'some-custom-repo',
        defaultBranch: 'main',
      })

      // Run scan to generate 3 recommendations
      await productService.runAnalysis('ws-outcome-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-outcome-a', 'proj-1')
      
      // Approve 1 recommendation
      await productService.approveAction('ws-outcome-a', 'proj-1', recs[0].id, recs[0].proposedActions[0].id)

      // Create 1 success outcome, 1 failed outcome
      const tsRec = recs.find((r) => r.title.toLowerCase().includes('typescript') || r.title.toLowerCase().includes('type'))!
      const testRec = recs.find((r) => r.title.toLowerCase().includes('test'))!

      const o1 = await productService.createOutcome(tsRec.id, 'ws-outcome-a', 'proj-1')
      await productService.verifyOutcome(o1.id, 'ws-outcome-a', { hasTypeScriptConfig: true }) // success

      const o2 = await productService.createOutcome(testRec.id, 'ws-outcome-a', 'proj-1')
      await productService.verifyOutcome(o2.id, 'ws-outcome-a', { hasVitestConfig: false }) // failed

      // Load Metrics
      const metrics = await productService.getDecisionQualityMetrics('ws-outcome-a', 'proj-1')
      
      expect(metrics.totalRecommendations).toBe(recs.length)
      expect(metrics.totalApproved).toBe(1)
      expect(metrics.acceptanceRate).toBeGreaterThan(0)
      expect(metrics.successCount).toBe(1)
      expect(metrics.successRate).toBe(50.0) // 1 of 2 succeeded!
    })
  })

  describe('3. Multi-Tenant Segregation (Item 16)', () => {
    it('ensures Workspace B has no visibility or access to Workspace A’s decision validation records', async () => {
      await productService.createWorkspace('ws-outcome-a', 'Acme A', 'acme-a')
      await productService.createProject('ws-outcome-a', 'proj-a', 'Project A')
      await productService.connectRepository('ws-outcome-a', 'proj-a', {
        provider: 'github',
        owner: 'acme-a',
        repository: 'apex',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-outcome-a', 'proj-a')
      const recs = await productService.getRecommendations('ws-outcome-a', 'proj-a')
      const outcome = await productService.createOutcome(recs[0].id, 'ws-outcome-a', 'proj-a')

      // Workspace B
      await productService.createWorkspace('ws-outcome-b', 'Acme B', 'acme-b')

      // 1. Workspace B cannot read Workspace A's outcome
      const fetched = await outcomeRepository.getByIdAndWorkspace(outcome.id, WORKSPACE_B)
      expect(fetched).toBeNull()

      // 2. Workspace B cannot verify Workspace A's outcome
      await expect(
        productService.verifyOutcome(outcome.id, 'ws-outcome-b', { hasVitestConfig: true })
      ).rejects.toThrow()
    })
  })
})
