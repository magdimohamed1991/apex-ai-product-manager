import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { SqlAdaptiveLearningProfileRepository } from '../../../infrastructure/repositories/SqlAdaptiveLearningProfileRepository'
import { ActionApplicationService } from '../ActionApplicationService'
import { RepositoryDiscoveryPipeline } from '../../../intelligence/pipeline/RepositoryDiscoveryPipeline'
import { PipelineActionOrchestrator } from '../PipelineActionOrchestrator'
import { EnvCredentialProvider } from '../CredentialProvider'
import { APEXProductService } from '../APEXProductService'
import { ProductIntelligenceService } from '../ProductIntelligenceService'
import { RecommendationOutcomeService } from '../RecommendationOutcomeService'
import { AdaptiveProfileCompiler } from '../AdaptiveProfileCompiler'
import { H6PrioritizationCalibrator } from '../H6PrioritizationCalibrator'
import { ProductValidationService } from '../ProductValidationService'
import { PMDecisionTelemetryService } from '../PMDecisionTelemetryService'
import { createWorkspaceId } from '../../../domain/value-objects'

const TEST_DB_DIR = path.join(process.cwd(), 'database-cross-project-service-test')

/**
 * Phase 3 — realistic cross-project isolation at the SERVICE layer.
 *
 * Two projects in the SAME workspace both connect and analyze the SAME
 * repository (the APEX monorepo). They must keep fully independent
 * findings/recommendations, and re-analyzing one project must never affect
 * the other. This is the real-world shape of Scenario A/B (a tenant who
 * tracks the same codebase under two projects).
 *
 * The repository-level collision contract is proven separately in
 * CrossProjectCollision.test.ts (which forces identical ids). This test
 * proves the end-to-end invariant holds through runAnalysis.
 */
function buildService(database: DurableFileDatabase) {
  const actionRepository = new SqlActionRepository(database)
  const productRepository = new SqlProductRepository(database)
  const outcomeRepository = new SqlRecommendationOutcomeRepository(database)
  const profileRepository = new SqlAdaptiveLearningProfileRepository(database)
  const actionAppService = new ActionApplicationService(actionRepository)
  const pipeline = new RepositoryDiscoveryPipeline()
  const orchestrator = new PipelineActionOrchestrator(pipeline, actionAppService)
  return new APEXProductService(
    productRepository,
    actionRepository,
    actionAppService,
    orchestrator,
    new EnvCredentialProvider(),
    new ProductIntelligenceService(),
    new RecommendationOutcomeService(outcomeRepository, productRepository, actionRepository),
    new AdaptiveProfileCompiler(
      profileRepository,
      productRepository,
      actionRepository,
      outcomeRepository
    ),
    profileRepository,
    new H6PrioritizationCalibrator(),
    new ProductValidationService(productRepository, actionRepository, outcomeRepository),
    new PMDecisionTelemetryService(productRepository)
  )
}

describe('APEXProductService — cross-project isolation (same workspace, two projects, same repo)', () => {
  let database: DurableFileDatabase
  let service: APEXProductService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    service = buildService(database)
    await service.createWorkspace('ws-shared', 'Shared Workspace', 'shared')
    await service.createProject('ws-shared', 'proj-a', 'Project A')
    await service.createProject('ws-shared', 'proj-b', 'Project B')
    const ws = createWorkspaceId('ws-shared')
    for (const p of ['proj-a', 'proj-b']) {
      await service.connectRepository('ws-shared', p, {
        provider: 'github',
        owner: 'apex',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      })
      void ws // workspace id brand not needed; service wraps internally
    }
  })

  afterAll(() => {
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
  })

  it('keeps both projects findings/recommendations independent after analyzing the same repo', async () => {
    await service.runAnalysis('ws-shared', 'proj-a')
    await service.runAnalysis('ws-shared', 'proj-b')

    const recsA = await service.getRecommendations('ws-shared', 'proj-a')
    const recsB = await service.getRecommendations('ws-shared', 'proj-b')
    const findingsA = await service.getFindings('ws-shared', 'proj-a')
    const findingsB = await service.getFindings('ws-shared', 'proj-b')

    // Both projects analyzed the same repo → both produced output.
    expect(recsA.length).toBeGreaterThan(0)
    expect(recsB.length).toBeGreaterThan(0)

    // Each recommendation row carries the CORRECT owning projectId.
    for (const r of recsA) expect((r as { projectId?: string }).projectId).toBe('proj-a')
    for (const r of recsB) expect((r as { projectId?: string }).projectId).toBe('proj-b')

    // Re-analyzing project B must not empty or corrupt project A's set.
    await service.runAnalysis('ws-shared', 'proj-b')
    const recsAAfter = await service.getRecommendations('ws-shared', 'proj-a')
    expect(recsAAfter.length).toBe(recsA.length)

    // Cross-project read isolation: reading A's findings never leaks B's.
    const idsA = new Set(findingsA.map((f) => f.id))
    for (const f of findingsB) expect(idsA.has(f.id)).toBe(false)
  })
})
