import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { SqlAdaptiveLearningProfileRepository } from '../../../infrastructure/repositories/SqlAdaptiveLearningProfileRepository'
import { ActionApplicationService, adapterRegistry } from '../ActionApplicationService'
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
import { GitHubAdapter } from '../adapters/GitHubAdapter'

const TEST_DB_DIR = path.join(process.cwd(), 'database-adaptive-intelligence-test')
const WORKSPACE_A = createWorkspaceId('ws-adaptive-a')
const WORKSPACE_B = createWorkspaceId('ws-adaptive-b')

describe('Milestone H6 — Adaptive Product Intelligence Tests', () => {
  let database: DurableFileDatabase
  let actionRepository: SqlActionRepository
  let productRepository: SqlProductRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let profileRepository: SqlAdaptiveLearningProfileRepository

  let actionAppService: ActionApplicationService
  let pipeline: RepositoryDiscoveryPipeline
  let orchestrator: PipelineActionOrchestrator
  let credentialProvider: EnvCredentialProvider
  let intelligenceService: ProductIntelligenceService
  let outcomeService: RecommendationOutcomeService
  let profileCompiler: AdaptiveProfileCompiler
  let calibrator: H6PrioritizationCalibrator
  let validationService: ProductValidationService
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
    profileRepository = new SqlAdaptiveLearningProfileRepository(database)

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

    profileCompiler = new AdaptiveProfileCompiler(
      profileRepository,
      productRepository,
      actionRepository,
      outcomeRepository
    )

    calibrator = new H6PrioritizationCalibrator()
    validationService = new ProductValidationService(
      productRepository,
      actionRepository,
      outcomeRepository
    )

    productService = new APEXProductService(
      productRepository,
      actionRepository,
      actionAppService,
      orchestrator,
      credentialProvider,
      intelligenceService,
      outcomeService,
      profileCompiler,
      profileRepository,
      calibrator,
      validationService,
      new PMDecisionTelemetryService(productRepository)
    )

    githubAdapter = new GitHubAdapter()
    adapterRegistry.clear()
    adapterRegistry.register(githubAdapter)
    GitHubAdapter.resetMockState()
  })

  describe('1. Adaptive Profile Compiler (Item 1 & Item 7)', () => {
    it('compiles precise category coefficients based on decisions and outcomes with confidence weighting', async () => {
      await productService.createWorkspace('ws-adaptive-a', 'Acme', 'acme')
      await productService.createProject('ws-adaptive-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-adaptive-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'some-custom-repo', // Trigger simulator to generate all 4 category recommendations
        defaultBranch: 'main',
      })

      // Generate initial recommendations
      await productService.runAnalysis('ws-adaptive-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-adaptive-a', 'proj-1')

      // Approve TESTING recommendations
      const testingRec = recs.find((r) => r.title.toLowerCase().includes('test'))!
      await productService.approveAction(
        'ws-adaptive-a',
        'proj-1',
        testingRec.id,
        testingRec.proposedActions[0].id
      )

      // Compile Profile
      const profile = await productService.compileAdaptiveProfile('ws-adaptive-a', 'proj-1')

      expect(profile.workspaceId).toBe(WORKSPACE_A)
      expect(profile.projectId).toBe('proj-1')
      expect(profile.totalDecisionsObserved).toBe(1)

      // Test coefficients list
      const testingCoef = profile.categoryCoefficients.find((c) => c.category === 'TESTING')!
      expect(testingCoef.adoptionRate).toBe(1.0) // Approved testing action out of 1 recommendation
      // Epistemic gate (no evidence != negative evidence): a single adoption
      // observation is INSUFFICIENT (< MIN_OBSERVATIONS_FOR_FAVORED), so the
      // adoption multiplier contribution is exactly neutral (1.0) — it must
      // not start influencing calibration on one data point in either
      // direction.
      expect(testingCoef.pmCalibrationWeight).toBe(1.0)
    })

    it('implements confidence safeguard to prevent overfitting from low sample sizes', async () => {
      await productService.createWorkspace('ws-adaptive-a', 'Acme', 'acme')
      await productService.createProject('ws-adaptive-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-adaptive-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'some-custom-repo',
        defaultBranch: 'main',
      })

      await productService.runAnalysis('ws-adaptive-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-adaptive-a', 'proj-1')

      // Approve 1 Testing recommendation (total testing observation = 1, very small sample)
      const testingRec = recs.find((r) => r.title.toLowerCase().includes('test'))!
      await productService.approveAction(
        'ws-adaptive-a',
        'proj-1',
        testingRec.id,
        testingRec.proposedActions[0].id
      )

      const profile = await productService.compileAdaptiveProfile('ws-adaptive-a', 'proj-1')
      const testingCoef = profile.categoryCoefficients.find((c) => c.category === 'TESTING')!

      // Because n=1, confidence is 1 / 11 = 0.09 (very low!), meaning the multiplier remains extremely neutral and safe
      expect(testingCoef.pmCalibrationWeight).toBeLessThan(1.05) // Safe multiplier limit preventing overfitting!
    })
  })

  describe('2. H6 Calibration Layer & Risk Preservation (Item 2 & Item 8)', () => {
    it('performs auditable calibration and strictly enforces safety floors to preserve critical objective risks', async () => {
      await productService.createWorkspace('ws-adaptive-a', 'Acme', 'acme')
      await productService.createProject('ws-adaptive-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-adaptive-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'some-custom-repo',
        defaultBranch: 'main',
      })

      await productService.runAnalysis('ws-adaptive-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-adaptive-a', 'proj-1')

      // Decline/ignore TS configurations to deflate its adoption weight
      const tsRec = recs.find(
        (r) =>
          r.title.toLowerCase().includes('typescript') || r.title.toLowerCase().includes('type')
      )!
      tsRec.priority = 'critical' // Set objective risk explicitly to critical
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(tsRec as any).priorityScore = 9.5
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await productRepository.saveRecommendation(tsRec as any, 'proj-1')

      // Mock an adverse profile where TypeScript category adoption is 0% with strong confidence
      const adverseProfile = {
        workspaceId: WORKSPACE_A,
        projectId: 'proj-1',
        totalDecisionsObserved: 20,
        lastCalculatedAt: new Date(),
        PMPreferences: { favoredCategories: [], ignoredCategories: ['TYPESCRIPT'] },
        categoryCoefficients: [
          {
            category: 'TYPESCRIPT',
            adoptionRate: 0.0, // PM consistently ignores TypeScript
            executionSuccessRate: 1.0,
            outcomeVerifiedRate: 0.0,
            pmCalibrationWeight: 0.5, // Deeply deflated weight multiplier
          },
        ],
        biasAdjustments: { overPrioritizedLowEffort: false, favoredHighImpact: false },
      }
      await profileRepository.saveProfile(adverseProfile)

      // The profile alone is NOT enough evidence to calibrate — the H6
      // contract gates calibration on compiled LEARNING SIGNALS with an
      // explicit evidence state. Save the signals that a real compilation
      // over 20 observed decisions (0% adoption) would have produced.
      await profileRepository.saveSignals([
        {
          id: 'sig-typescript-adoption-adverse',
          workspaceId: WORKSPACE_A,
          projectId: 'proj-1',
          category: 'TYPESCRIPT',
          type: 'ADOPTION',
          observationCount: 20,
          value: 0,
          confidence: 20 / 30,
          sourceRecommendationIds: [tsRec.id],
          generatedAt: new Date(),
          evidenceState: 'observed',
          calibrationVersion: 'h6-v2',
        },
      ])

      // Calibrate
      const calibration = await productService.getPriorityCalibration(
        'ws-adaptive-a',
        'proj-1',
        tsRec.id
      )

      expect(calibration.baseScore).toBe(9.5) // Canonical base score remains intact!
      // The calibration contract (h6-v2) bounds the preference multiplier to
      // [0.85, 1.15] — a profile coefficient of 0.5 (only possible via a
      // hand-built fixture; the compiler clamps to the documented range) is
      // clamped to the floor instead of being applied verbatim.
      expect(calibration.preferenceMultiplier).toBe(0.85)

      // Preservation of Objective Risk guard: critical must not drop below 8.5 safety floor
      expect(calibration.calibratedScore).toBe(8.5)
      expect(calibration.explanation).toContain(
        'Safety floor was explicitly enforced to preserve critical objective risk'
      )
    })
  })

  describe('3. Multi-Tenant Segregation (Item 9)', () => {
    it('ensures Workspace B has zero cross-contamination from Workspace A’s adaptive signals and profiles', async () => {
      // Workspace A Setup
      await productService.createWorkspace('ws-adaptive-a', 'Acme A', 'acme-a')
      await productService.createProject('ws-adaptive-a', 'proj-a', 'Project A')
      await productService.connectRepository('ws-adaptive-a', 'proj-a', {
        provider: 'github',
        owner: 'acme-a',
        repository: 'some-custom-repo',
        defaultBranch: 'main',
      })
      await productService.runAnalysis('ws-adaptive-a', 'proj-a')
      await productService.compileAdaptiveProfile('ws-adaptive-a', 'proj-a')

      // Workspace B Setup
      await productService.createWorkspace('ws-adaptive-b', 'Acme B', 'acme-b')
      await productService.createProject('ws-adaptive-b', 'proj-b', 'Project B')

      // 1. Workspace B cannot retrieve Workspace A's compiled profile
      const fetched = await profileRepository.getProfile(WORKSPACE_B, 'proj-b')
      expect(fetched).toBeNull()

      // 2. Querying Priority Calibration for Workspace B rejects with missing profile parameters
      await expect(
        productService.getPriorityCalibration('ws-adaptive-b', 'proj-b', 'some-rec-id')
      ).rejects.toThrow()
    })
  })

  describe('4. Determinism & Provenance (Item 10)', () => {
    it('proves that the exact same historical datasets yield identical reproducible adaptive multipliers', async () => {
      await productService.createWorkspace('ws-adaptive-a', 'Acme', 'acme')
      await productService.createProject('ws-adaptive-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-adaptive-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'some-custom-repo',
        defaultBranch: 'main',
      })

      await productService.runAnalysis('ws-adaptive-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-adaptive-a', 'proj-1')
      const testingRec = recs.find((r) => r.title.toLowerCase().includes('test'))!
      await productService.approveAction(
        'ws-adaptive-a',
        'proj-1',
        testingRec.id,
        testingRec.proposedActions[0].id
      )

      // Run profile compiler twice
      const run1 = await productService.compileAdaptiveProfile('ws-adaptive-a', 'proj-1')
      const run2 = await productService.compileAdaptiveProfile('ws-adaptive-a', 'proj-1')

      expect(run1.categoryCoefficients[0].pmCalibrationWeight).toEqual(
        run2.categoryCoefficients[0].pmCalibrationWeight
      )
      expect(run1.PMPreferences).toEqual(run2.PMPreferences)
    })
  })

  describe('5. Milestone H7 — Product Validation Metrics (H7)', () => {
    it('evaluates comprehensive product leverage metrics for APEX PM decisions correctly', async () => {
      await productService.createWorkspace('ws-adaptive-a', 'Acme', 'acme')
      await productService.createProject('ws-adaptive-a', 'proj-1', 'Project Core')
      await productService.connectRepository('ws-adaptive-a', 'proj-1', {
        provider: 'github',
        owner: 'acme',
        repository: 'some-custom-repo',
        defaultBranch: 'main',
      })

      await productService.runAnalysis('ws-adaptive-a', 'proj-1')
      const recs = await productService.getRecommendations('ws-adaptive-a', 'proj-1')

      // Approve 1 recommendation
      const testingRec = recs.find((r) => r.title.toLowerCase().includes('test'))!
      await productService.approveAction(
        'ws-adaptive-a',
        'proj-1',
        testingRec.id,
        testingRec.proposedActions[0].id
      )

      // Record a REAL PM decision into the H7 telemetry stream — the
      // acceptance metric is ACCEPT telemetry / decision telemetry.
      await productService.recordPMDecision({
        workspaceId: 'ws-adaptive-a',
        projectId: 'proj-1',
        recommendationId: testingRec.id,
        decision: 'ACCEPT',
        decisionStartedAt: new Date('2026-08-09T10:00:00Z'),
        decisionCompletedAt: new Date('2026-08-09T10:01:00Z'),
        recommendationPresentedAt: new Date('2026-08-09T09:59:00Z'),
      })

      // Evaluate
      const metrics = await productService.getProductValidationMetrics('ws-adaptive-a', 'proj-1')

      // H7 — every metric now carries an explicit epistemic state. We assert
      // that the observation is properly recorded and not synthesized.
      expect(metrics.decisionAcceptanceRate.value).not.toBeNull()
      expect(metrics.decisionAcceptanceRate.value!).toBe(100) // 1 ACCEPT / 1 decision
      expect(metrics.decisionAcceptanceRate.epistemicState).toBe('observed')
      expect(metrics.decisionAcceptanceRate.observationCount).toBe(1)
      // The PM decision metrics are separate populations.
      expect(metrics.decisionRejectionRate.value).toBe(0)
      expect(metrics.decisionOverrideRate.value).toBe(0)
      expect(metrics.measuredDecisionLatencySeconds.value).toBe(60)
      // No synthetic "business utility" — that metric is no longer exposed.
      expect((metrics as unknown as { businessUtility?: unknown }).businessUtility).toBeUndefined()
      // Confidence bucket is correct
      expect(metrics.confidence.bucket).toBeDefined()
    })
  })
})
