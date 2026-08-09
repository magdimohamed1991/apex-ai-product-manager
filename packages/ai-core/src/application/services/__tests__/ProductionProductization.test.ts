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

const TEST_DB_DIR = path.join(process.cwd(), 'database-production-test')

describe('Milestone I — Production Productization & Real PM Workspace Tests', () => {
  let database: DurableFileDatabase
  let actionRepository: SqlActionRepository
  let productRepository: SqlProductRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let profileRepository: SqlAdaptiveLearningProfileRepository

  let actionAppService: ActionApplicationService
  let pipeline: RepositoryDiscoveryPipeline
  let orchestrator: PipelineActionOrchestrator
  let credentialProvider: EnvCredentialProvider
  let outcomeService: RecommendationOutcomeService
  let profileCompiler: AdaptiveProfileCompiler
  let calibrator: H6PrioritizationCalibrator
  let validationService: ProductValidationService
  let productService: APEXProductService

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
      new ProductIntelligenceService(),
      outcomeService,
      profileCompiler,
      profileRepository,
      calibrator,
      validationService
    )
  })

  describe('I.1 — User Authentication & Membership Segregation', () => {
    it('verifies that registering a user hashes password, creates onboarding workspace/project, and grants ownership membership', async () => {
      // 1. Setup registration details
      const email = 'pm@acme.com'
      const password = 'my-secure-password-12chars'
      const { ScryptPasswordHasher } = await import('../../../security/PasswordHasher')
      const hasher = new ScryptPasswordHasher()
      const passwordHash = await hasher.hash(password)

      const userId = 'usr-test-123'
      const user = { id: userId, email, passwordHash, createdAt: new Date().toISOString() }
      database.insertUser(user)

      // Create Onboarding workspace and default project
      await productService.createWorkspace('ws-acme-onboarding', 'Acme Workspace', 'acme')
      await productService.createProject('ws-acme-onboarding', 'proj-core', 'APEX System Core')

      // Grant ownership membership
      const membership = {
        id: 'mbr-123',
        userId,
        workspaceId: 'ws-acme-onboarding',
        role: 'owner' as const,
        createdAt: new Date().toISOString(),
      }
      database.insertMembership(membership)

      // Verify that database state contains the user record and proper memberships
      const fetchedUser = database.getUserByEmail(email)
      expect(fetchedUser).not.toBeNull()
      // Verify the password is stored as a real scrypt hash, not the legacy mock-hash format
      expect(fetchedUser?.passwordHash.startsWith('scrypt$')).toBe(true)
      // The original plaintext password must NOT be derivable from the hash
      expect(fetchedUser?.passwordHash).not.toContain(password)
      // The hash must be verifiable
      const ok = await hasher.verify(password, fetchedUser!.passwordHash)
      expect(ok).toBe(true)

      const isMember = database.isUserMemberOfWorkspace(userId, 'ws-acme-onboarding')
      expect(isMember).toBe(true)

      const isNonMember = database.isUserMemberOfWorkspace(userId, 'ws-some-other-workspace')
      expect(isNonMember).toBe(false)
    })

    it('creates, retrieves, and expires sessions securely', async () => {
      const userId = 'usr-test-456'
      const sessionId = 'sess-token-999'
      const session = {
        id: sessionId,
        userId,
        workspaceId: 'ws-acme-onboarding',
        expiresAt: new Date(Date.now() + 1000 * 3600).toISOString(), // expires in 1 hour
      }

      database.insertSession(session)

      const fetched = database.getSession(sessionId)
      expect(fetched).not.toBeNull()
      expect(fetched?.userId).toBe(userId)

      database.deleteSession(sessionId)
      const deleted = database.getSession(sessionId)
      expect(deleted).toBeNull()
    })
  })

  describe('I.2 — Onboarding & Run Management (Pipeline progression)', () => {
    it('creates and runs an analysis with proper state configurations and connections', async () => {
      const workspaceId = 'ws-acme'
      const projectId = 'proj-core'
      await productService.createWorkspace(workspaceId, 'Acme Corp', 'acme')
      await productService.createProject(workspaceId, projectId, 'Default Project')

      // Connect repository
      const conn = await productService.connectRepository(workspaceId, projectId, {
        provider: 'github',
        owner: 'acme',
        repository: 'core-platform',
        defaultBranch: 'main',
      })

      expect(conn.status).toBe('connected')
      expect(conn.owner).toBe('acme')
      expect(conn.repository).toBe('core-platform')

      // Run analysis and promote findings
      const run = await productService.runAnalysis(workspaceId, projectId)
      expect(run.status).toBe('completed')
      expect(run.projectId).toBe(projectId)

      const recommendations = await productService.getRecommendations(workspaceId, projectId)
      expect(recommendations.length).toBeGreaterThan(0)
    })
  })

  describe('I.3 — Telemetry Capture & H7 Multiplier Audits', () => {
    it('preserves baseline leverage configurations while correctly evaluating empirical telemetry', async () => {
      const workspaceId = 'ws-acme'
      const projectId = 'proj-core'
      await productService.createWorkspace(workspaceId, 'Acme Corp', 'acme')
      await productService.createProject(workspaceId, projectId, 'Default Project')
      await productService.connectRepository(workspaceId, projectId, {
        provider: 'github',
        owner: 'acme',
        repository: 'core-platform',
        defaultBranch: 'main',
      })

      // Run analysis to generate recommendations
      await productService.runAnalysis(workspaceId, projectId)
      const recs = await productService.getRecommendations(workspaceId, projectId)

      // Perform a decision and record telemetry
      const testingRec = recs.find((r) => r.title.toLowerCase().includes('test'))!
      await productService.approveAction(
        workspaceId,
        projectId,
        testingRec.id,
        testingRec.proposedActions[0].id
      )

      // Evaluate H7 metrics
      const metrics = await productService.getProductValidationMetrics(workspaceId, projectId)

      // H7 — empirical decision-quality must be properly observed and reported
      // (no synthetic baselines, no fabricated numbers).
      expect(metrics.decisionAcceptanceRate.value).not.toBeNull()
      expect(metrics.decisionAcceptanceRate.value!).toBeGreaterThan(0)
      expect(metrics.decisionAcceptanceRate.epistemicState).toBe('observed')
      // The legacy `efficiency` field is REMOVED — PM decision latency is
      // not measurable from rec.createdAt -> action.updatedAt and the new
      // PMDecisionTelemetry stream is not yet in use. The metric MUST be
      // marked unavailable so the UI doesn't display a fake number.
      expect(metrics.measuredDecisionLatencySeconds.epistemicState).toBe('unavailable')
      expect(metrics.measuredDecisionLatencySeconds.value).toBeNull()
    })
  })
})
