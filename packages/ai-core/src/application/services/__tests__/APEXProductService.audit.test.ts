import { describe, it, expect, beforeEach } from 'vitest'
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
import { NotFoundError, SecurityError } from '../../../errors/AppError'
import { createWorkspaceId } from '../../../domain/value-objects'

const TEST_DB_DIR = path.join(process.cwd(), 'database-audit-regression-test')

function buildService() {
  const database = new DurableFileDatabase(TEST_DB_DIR)
  const actionRepository = new SqlActionRepository(database)
  const productRepository = new SqlProductRepository(database)
  const outcomeRepository = new SqlRecommendationOutcomeRepository(database)
  const profileRepository = new SqlAdaptiveLearningProfileRepository(database)
  const actionAppService = new ActionApplicationService(actionRepository)
  const pipeline = new RepositoryDiscoveryPipeline()
  const orchestrator = new PipelineActionOrchestrator(pipeline, actionAppService)
  const productService = new APEXProductService(
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
    new ProductValidationService(productRepository, actionRepository, outcomeRepository)
  )
  return { database, actionRepository, productRepository, outcomeRepository, productService }
}

describe('APEXProductService audit-regression tests', () => {
  let ctx: ReturnType<typeof buildService>

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    ctx = buildService()
    await ctx.database.initialize()
    await ctx.productService.createWorkspace('ws-a', 'Workspace A', 'a')
    await ctx.productService.createProject('ws-a', 'proj-a', 'Project A')
    await ctx.productService.createWorkspace('ws-b', 'Workspace B', 'b')
    await ctx.productService.createProject('ws-b', 'proj-b', 'Project B')
  })

  it('rejects approval of a recommendation that does not belong to the given project', async () => {
    await ctx.productService.connectRepository('ws-a', 'proj-a', {
      provider: 'github',
      owner: 'acme',
      repository: 'apex-ai-product-manager',
      defaultBranch: 'main',
    })
    await ctx.productService.runAnalysis('ws-a', 'proj-a')
    const recs = await ctx.productService.getRecommendations('ws-a', 'proj-a')
    const rec = recs[0]

    // Same workspace, WRONG project id → must be denied.
    await expect(
      ctx.productService.approveAction('ws-a', 'proj-b', rec.id, rec.proposedActions[0].id)
    ).rejects.toThrow(NotFoundError)
  })

  it('is idempotent: double approval returns the same action and appends no duplicate transition', async () => {
    await ctx.productService.connectRepository('ws-a', 'proj-a', {
      provider: 'github',
      owner: 'acme',
      repository: 'apex-ai-product-manager',
      defaultBranch: 'main',
    })
    await ctx.productService.runAnalysis('ws-a', 'proj-a')
    const recs = await ctx.productService.getRecommendations('ws-a', 'proj-a')
    const rec = recs[0]
    const paId = rec.proposedActions[0].id

    const action1 = await ctx.productService.approveAction('ws-a', 'proj-a', rec.id, paId)
    expect(action1.status).toBe('approved')
    const transitionsAfterFirst = await ctx.actionRepository.getTransitionsByAction(
      action1.id,
      createWorkspaceId('ws-a')
    )
    expect(transitionsAfterFirst.length).toBe(1)

    // Second approval (e.g. double-click) must be a no-op.
    const action2 = await ctx.productService.approveAction('ws-a', 'proj-a', rec.id, paId)
    expect(action2.id).toBe(action1.id)
    const transitionsAfterSecond = await ctx.actionRepository.getTransitionsByAction(
      action1.id,
      createWorkspaceId('ws-a')
    )
    expect(transitionsAfterSecond.length).toBe(1)
    expect(transitionsAfterSecond[0].fromStatus).toBe('proposed')
    expect(transitionsAfterSecond[0].toStatus).toBe('approved')
  })

  it('getActivityLog uses real persisted timestamps, not read-time "now"', async () => {
    await ctx.productService.connectRepository('ws-a', 'proj-a', {
      provider: 'github',
      owner: 'acme',
      repository: 'apex-ai-product-manager',
      defaultBranch: 'main',
    })
    await ctx.productService.runAnalysis('ws-a', 'proj-a')

    const recs = await ctx.productService.getRecommendations('ws-a', 'proj-a')
    const log = await ctx.productService.getActivityLog('ws-a', 'proj-a')

    const recEvents = log.filter((e) => e.type === 'recommendation')
    expect(recEvents.length).toBeGreaterThan(0)
    for (const ev of recEvents) {
      const rec = recs.find((r) => r.id === ev.metadata?.recommendationId)
      expect(rec).toBeDefined()
      // The event timestamp must equal the persisted creation time (within
      // serialization precision), NOT the time the log was read.
      expect(Math.abs(ev.timestamp.getTime() - new Date(rec!.createdAt).getTime())).toBeLessThan(2)
    }
  })

  it('getDecisionQualityMetrics scopes approvals to the project, not the workspace', async () => {
    // Both projects get identical analysis runs; only project A actions are approved.
    for (const ws of ['ws-a', 'ws-b']) {
      await ctx.productService.connectRepository(ws, ws === 'ws-a' ? 'proj-a' : 'proj-b', {
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      })
      await ctx.productService.runAnalysis(ws, ws === 'ws-a' ? 'proj-a' : 'proj-b')
    }
    const recsA = await ctx.productService.getRecommendations('ws-a', 'proj-a')
    const recsB = await ctx.productService.getRecommendations('ws-b', 'proj-b')
    expect(recsA.length).toBeGreaterThan(0)
    expect(recsB.length).toBeGreaterThan(0)

    await ctx.productService.approveAction(
      'ws-a',
      'proj-a',
      recsA[0].id,
      recsA[0].proposedActions[0].id
    )

    const metricsA = await ctx.productService.getDecisionQualityMetrics('ws-a', 'proj-a')
    const metricsB = await ctx.productService.getDecisionQualityMetrics('ws-b', 'proj-b')

    // Project A has exactly one approval; project B must NOT inherit it.
    expect(metricsA.totalApproved).toBe(1)
    expect(metricsB.totalApproved).toBe(0)
    expect(metricsB.acceptanceRate).toBe(0)
    expect(metricsA.acceptanceRate).toBeGreaterThan(0)
  })

  it('createOutcome rejects a recommendation that does not belong to the claimed project', async () => {
    await ctx.productService.connectRepository('ws-a', 'proj-a', {
      provider: 'github',
      owner: 'acme',
      repository: 'apex-ai-product-manager',
      defaultBranch: 'main',
    })
    await ctx.productService.runAnalysis('ws-a', 'proj-a')
    const recs = await ctx.productService.getRecommendations('ws-a', 'proj-a')
    const rec = recs[0]

    // Same workspace, WRONG project id → the outcome must NOT be created
    // (otherwise it would contaminate proj-b's outcome metrics).
    await expect(ctx.productService.createOutcome(rec.id, 'ws-a', 'proj-b')).rejects.toThrow(
      /belongs to project/
    )
    const outcomesB = await ctx.productService.getOutcomesByProject('ws-a', 'proj-b')
    expect(outcomesB).toHaveLength(0)
  })

  it('createOutcome rejects a non-existent recommendation (no phantom PENDING outcomes)', async () => {
    await expect(
      ctx.productService.createOutcome('rec-does-not-exist', 'ws-a', 'proj-a')
    ).rejects.toThrow(/not found/)
    const outcomesA = await ctx.productService.getOutcomesByProject('ws-a', 'proj-a')
    expect(outcomesA).toHaveLength(0)
  })

  it('getPriorityCalibration rejects a recommendation from another project', async () => {
    await ctx.productService.connectRepository('ws-a', 'proj-a', {
      provider: 'github',
      owner: 'acme',
      repository: 'apex-ai-product-manager',
      defaultBranch: 'main',
    })
    await ctx.productService.runAnalysis('ws-a', 'proj-a')
    const recs = await ctx.productService.getRecommendations('ws-a', 'proj-a')
    const rec = recs[0]

    // Calibrating proj-a's recommendation with proj-b's profile/signals
    // would silently mix scopes — must be rejected.
    await expect(
      ctx.productService.getPriorityCalibration('ws-a', 'proj-b', rec.id)
    ).rejects.toThrow(/belongs to project/)
  })

  it('getActivityLog scopes action/execution events to the project, not the workspace', async () => {
    // Two projects in the SAME workspace; approve an action only in proj-a.
    await ctx.productService.connectRepository('ws-a', 'proj-a', {
      provider: 'github',
      owner: 'acme',
      repository: 'apex-ai-product-manager',
      defaultBranch: 'main',
    })
    await ctx.productService.runAnalysis('ws-a', 'proj-a')
    const recsA = await ctx.productService.getRecommendations('ws-a', 'proj-a')
    await ctx.productService.approveAction(
      'ws-a',
      'proj-a',
      recsA[0].id,
      recsA[0].proposedActions[0].id
    )

    // Create a second project with its own analysis (creates proposed
    // actions in the same workspace) but no approvals.
    await ctx.productService.createProject('ws-a', 'proj-extra', 'Project Extra')
    await ctx.productService.connectRepository('ws-a', 'proj-extra', {
      provider: 'github',
      owner: 'acme',
      repository: 'apex-ai-product-manager',
      defaultBranch: 'main',
    })
    await ctx.productService.runAnalysis('ws-a', 'proj-extra')

    const logA = await ctx.productService.getActivityLog('ws-a', 'proj-a')
    const logExtra = await ctx.productService.getActivityLog('ws-a', 'proj-extra')

    const actionEventsA = logA.filter((e) => e.type === 'action')
    const actionEventsExtra = logExtra.filter((e) => e.type === 'action')

    // proj-a has its own approval transition; proj-extra must NOT see it
    // (the legacy implementation surfaced ALL workspace actions).
    expect(actionEventsA.length).toBeGreaterThan(0)
    expect(actionEventsExtra.length).toBe(0)
  })

  it('refuses to run a mock analysis in production when the clone cannot happen', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await ctx.productService.connectRepository('ws-a', 'proj-a', {
        provider: 'github',
        owner: 'acme',
        repository: 'private-corp-repo',
        defaultBranch: 'main',
      })
      await expect(ctx.productService.runAnalysis('ws-a', 'proj-a')).rejects.toThrow(SecurityError)
      // The pipeline run must be recorded as failed, not completed.
      const runs = await ctx.productService.getPipelineRuns('ws-a', 'proj-a')
      expect(runs[runs.length - 1].status).toBe('failed')
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})
