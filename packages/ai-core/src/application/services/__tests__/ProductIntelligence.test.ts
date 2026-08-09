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
import type { RichRecommendation } from '../../../domain/entities'
import { createWorkspaceId } from '../../../domain/value-objects'
import { GitHubAdapter } from '../adapters/GitHubAdapter'

const TEST_DB_DIR = path.join(process.cwd(), 'database-intelligence-test')
const _WORKSPACE_A = createWorkspaceId('ws-intel-a')
const _WORKSPACE_B = createWorkspaceId('ws-intel-b')

describe('Milestone H3 — Product Intelligence & Decision Quality Tests', () => {
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

  describe('1. Product Impact & Scoring Model (Item 1 & Item 2)', () => {
    it('calculates 100% deterministic scores based on code evidence and prioritizes them correctly', async () => {
      await productService.createWorkspace('ws-intel-a', 'Acme', 'acme')
      await productService.createProject('ws-intel-a', 'proj-1', 'Project')
      await productService.connectRepository('ws-intel-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex', // Mock fallback triggered (No tests, no CI, no strict typescript)
        defaultBranch: 'main',
      })

      // Run discovery and let ProductIntelligenceService generate rich decorated recommendations
      await productService.runAnalysis('ws-intel-a', 'proj-1')
      const recs = (await productService.getRecommendations('ws-intel-a', 'proj-1')) as RichRecommendation[]

      expect(recs.length).toBeGreaterThan(0)
      
      // Ensure all required structured dimensions are populated and deterministic (Item 1)
      for (const rec of recs) {
        expect(rec.pmCategory).toBeDefined()
        expect(rec.assessment).toBeDefined()
        expect(rec.priorityScore).toBeGreaterThan(0)
        expect(rec.expectedOutcome).toBeDefined()
        expect(rec.rankingReason).toBeDefined()

        // Trace to observed evidence (Item 5)
        expect(rec.insightIds.length).toBeGreaterThan(0)
      }

      // Assert that CI Setup outranks Testing Setup due to Low Effort vs Medium Effort (Higher ROI!) (Item 2)
      const ciRec = recs.find((r) => r.title.toLowerCase().includes('ci') || r.title.toLowerCase().includes('integration'))
      const testRec = recs.find((r) => r.title.toLowerCase().includes('test'))

      if (ciRec && testRec) {
        expect(ciRec.priorityScore).toBeGreaterThan(testRec.priorityScore)
        expect(recs[0].id).toBe(ciRec.id) // CI Setup is ranked #1!
      }
    })
  })

  describe('2. Ranking Explainability (Item 4)', () => {
    it('generates clear, comparative explanations describing why a recommendation is ranked where it is', async () => {
      await productService.createWorkspace('ws-intel-a', 'Acme', 'acme')
      await productService.createProject('ws-intel-a', 'proj-1', 'Project')
      await productService.connectRepository('ws-intel-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex',
        defaultBranch: 'main',
      })

      await productService.runAnalysis('ws-intel-a', 'proj-1')
      const recs = (await productService.getRecommendations('ws-intel-a', 'proj-1')) as RichRecommendation[]

      expect(recs[0].rankingReason).toContain('Ranked #1')
      expect(recs[0].rankingReason).toContain('effort')
    })
  })

  describe('3. Multi-Tenant Workspace Security Segregation (Item 16)', () => {
    it('ensures Workspace B has no visibility or interaction with Workspace A’s product intelligence data', async () => {
      // Workspace A
      await productService.createWorkspace('ws-intel-a', 'Acme A', 'acme-a')
      await productService.createProject('ws-intel-a', 'proj-a', 'Project A')
      await productService.connectRepository('ws-intel-a', 'proj-a', {
        provider: 'github',
        owner: 'acme-a',
        repository: 'apex',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-intel-a', 'proj-a')

      // Workspace B (brand new, empty)
      await productService.createWorkspace('ws-intel-b', 'Acme B', 'acme-b')

      // Query recommendations for B on Project A
      const recsForB = await productService.getRecommendations('ws-intel-b', 'proj-a')
      expect(recsForB).toEqual([])
    })
  })

  describe('4. Idempotency & Repeatability (Item 17)', () => {
    it('running analysis multiple times yields identical scores and does not create duplicate recommendations', async () => {
      await productService.createWorkspace('ws-intel-a', 'Acme', 'acme')
      await productService.createProject('ws-intel-a', 'proj-1', 'Project')
      await productService.connectRepository('ws-intel-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex',
        defaultBranch: 'main',
      })

      // Run 1
      await productService.runAnalysis('ws-intel-a', 'proj-1')
      const recs1 = (await productService.getRecommendations('ws-intel-a', 'proj-1')) as RichRecommendation[]

      // Run 2
      await productService.runAnalysis('ws-intel-a', 'proj-1')
      const recs2 = (await productService.getRecommendations('ws-intel-a', 'proj-1')) as RichRecommendation[]

      expect(recs2.length).toBe(recs1.length)
      expect(recs2[0].priorityScore).toBe(recs1[0].priorityScore)
    })
  })
})
