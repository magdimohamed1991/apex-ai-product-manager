import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { SqlAdaptiveLearningProfileRepository } from '../../../infrastructure/repositories/SqlAdaptiveLearningProfileRepository'
import {
  AdaptiveProfileCompiler,
  CALIBRATION_VERSION,
  MIN_OBSERVATIONS_FOR_FAVORED,
} from '../AdaptiveProfileCompiler'
import { H6PrioritizationCalibrator } from '../H6PrioritizationCalibrator'
import {
  createWorkspaceId,
  createWorkspaceName,
  createWorkspaceSlug,
} from '../../../domain/value-objects'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h6-hardening-test')

describe('AdaptiveProfileCompiler & H6 Calibrator (Milestone I - Production Hardening)', () => {
  let database: DurableFileDatabase
  let actionRepository: SqlActionRepository
  let productRepository: SqlProductRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let profileRepository: SqlAdaptiveLearningProfileRepository
  let compiler: AdaptiveProfileCompiler
  let calibrator: H6PrioritizationCalibrator

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
    compiler = new AdaptiveProfileCompiler(
      profileRepository,
      productRepository,
      actionRepository,
      outcomeRepository
    )
    calibrator = new H6PrioritizationCalibrator()
  })

  it('records the calibration version on the profile', async () => {
    const ws = createWorkspaceId('ws-1')
    await productRepository.saveWorkspace({
      id: ws,
      name: createWorkspaceName('WS'),
      slug: createWorkspaceSlug('ws'),
      type: 'saas',
      status: 'active',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const profile = await compiler.compileProfile(ws, 'proj-1')
    expect(profile.calibrationVersion).toBe(CALIBRATION_VERSION)
  })

  it('produces deterministic signal IDs for the same observation set', async () => {
    const ws = createWorkspaceId('ws-2')
    await productRepository.saveWorkspace({
      id: ws,
      name: createWorkspaceName('WS'),
      slug: createWorkspaceSlug('ws'),
      type: 'saas',
      status: 'active',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    // Insert 4 recommendations in TESTING category
    for (let i = 0; i < 4; i++) {
      await productRepository.saveRecommendation(
        {
          id: `rec-t-${i}`,
          workspaceId: ws,
          origin: 'insight',
          deduplicationKey: `k-${i}`,
          title: 'Test',
          rationale: 'r',
          impact: 'i',
          effort: 'medium',
          priority: 'high',
          confidence: 0.9,
          insightIds: ['i'],
          findingIds: [],
          proposedActions: [{ id: `pa-${i}`, title: 'a', description: 'a' }],
          createdAt: new Date(),
          category: 'TESTING',
        },
        'proj-1'
      )
    }
    const p1 = await compiler.compileProfile(ws, 'proj-1')
    const p2 = await compiler.compileProfile(ws, 'proj-1')
    const s1 = p1.categoryCoefficients.find((c) => c.category === 'TESTING')!
    const s2 = p2.categoryCoefficients.find((c) => c.category === 'TESTING')!
    expect(s1.pmCalibrationWeight).toBe(s2.pmCalibrationWeight)
    // The signal IDs (if any were generated) should be deterministic
    const s1Signals = await profileRepository.getSignals(ws, 'proj-1')
    const s1FirstId = s1Signals[0]?.id
    const s2Signals = await profileRepository.getSignals(ws, 'proj-1')
    const s2FirstId = s2Signals[0]?.id
    if (s1FirstId) {
      // re-run and verify the same logical signal yields the same id
      await compiler.compileProfile(ws, 'proj-1')
      const s3Signals = await profileRepository.getSignals(ws, 'proj-1')
      expect(s3Signals[0]?.id).toBe(s1FirstId)
      expect(s2FirstId).toBe(s1FirstId)
    }
  })

  it('does not generate a signal for a category with too few recommendations', async () => {
    const ws = createWorkspaceId('ws-3')
    await productRepository.saveWorkspace({
      id: ws,
      name: createWorkspaceName('WS'),
      slug: createWorkspaceSlug('ws'),
      type: 'saas',
      status: 'active',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    // Only 1 recommendation in TESTING (below MIN_OBSERVATIONS_FOR_SIGNAL)
    await productRepository.saveRecommendation(
      {
        id: 'rec-1',
        workspaceId: ws,
        origin: 'insight',
        deduplicationKey: 'k-1',
        title: 'Test',
        rationale: 'r',
        impact: 'i',
        effort: 'medium',
        priority: 'high',
        confidence: 0.9,
        insightIds: ['i'],
        findingIds: [],
        proposedActions: [{ id: 'pa-1', title: 'a', description: 'a' }],
        createdAt: new Date(),
        category: 'TESTING',
      },
      'proj-1'
    )
    const profile = await compiler.compileProfile(ws, 'proj-1')
    const signals = await profileRepository.getSignals(ws, 'proj-1')
    const testingSignal = signals.find((s) => s.category === 'TESTING' && s.type === 'ADOPTION')
    expect(testingSignal).toBeUndefined()
    // Coefficient is still computed
    expect(profile.categoryCoefficients.length).toBe(4)
  })

  it('does not mark a category as "favored" without enough observations', async () => {
    const ws = createWorkspaceId('ws-4')
    await productRepository.saveWorkspace({
      id: ws,
      name: createWorkspaceName('WS'),
      slug: createWorkspaceSlug('ws'),
      type: 'saas',
      status: 'active',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    // 4 recommendations, all approved (adoptionRate = 1.0 >= 0.75)
    for (let i = 0; i < 4; i++) {
      await productRepository.saveRecommendation(
        {
          id: `rec-${i}`,
          workspaceId: ws,
          origin: 'insight',
          deduplicationKey: `k-${i}`,
          title: 'Test',
          rationale: 'r',
          impact: 'i',
          effort: 'medium',
          priority: 'high',
          confidence: 0.9,
          insightIds: ['i'],
          findingIds: [],
          proposedActions: [{ id: `pa-${i}`, title: 'a', description: 'a' }],
          createdAt: new Date(),
          category: 'TESTING',
        },
        'proj-1'
      )
    }
    // Save 4 actions, all approved
    for (let i = 0; i < 4; i++) {
      await actionRepository.save({
        id: `act-${i}`,
        workspaceId: ws,
        title: 'a',
        description: 'a',
        target: 'internal',
        status: 'approved',
        relatedRecommendationId: `rec-${i}`,
        relatedProposedActionId: `pa-${i}`,
        idempotencyKey: `promo:ws-4:rec-${i}:pa-${i}`,
        claimedByExecutionId: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        externalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    const profile = await compiler.compileProfile(ws, 'proj-1')
    // 4 observations, below the favored threshold of 5
    expect(profile.PMPreferences.favoredCategories).not.toContain('TESTING')
  })

  it('marks "favored" once observations cross the threshold', async () => {
    const ws = createWorkspaceId('ws-5')
    await productRepository.saveWorkspace({
      id: ws,
      name: createWorkspaceName('WS'),
      slug: createWorkspaceSlug('ws'),
      type: 'saas',
      status: 'active',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const N = MIN_OBSERVATIONS_FOR_FAVORED
    for (let i = 0; i < N + 1; i++) {
      await productRepository.saveRecommendation(
        {
          id: `rec-${i}`,
          workspaceId: ws,
          origin: 'insight',
          deduplicationKey: `k-${i}`,
          title: 'Test',
          rationale: 'r',
          impact: 'i',
          effort: 'medium',
          priority: 'high',
          confidence: 0.9,
          insightIds: ['i'],
          findingIds: [],
          proposedActions: [{ id: `pa-${i}`, title: 'a', description: 'a' }],
          createdAt: new Date(),
          category: 'TESTING',
        },
        'proj-1'
      )
      await actionRepository.save({
        id: `act-${i}`,
        workspaceId: ws,
        title: 'a',
        description: 'a',
        target: 'internal',
        status: 'approved',
        relatedRecommendationId: `rec-${i}`,
        relatedProposedActionId: `pa-${i}`,
        idempotencyKey: `promo:ws-5:rec-${i}:pa-${i}`,
        claimedByExecutionId: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        externalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    const profile = await compiler.compileProfile(ws, 'proj-1')
    expect(profile.PMPreferences.favoredCategories).toContain('TESTING')
  })

  it('H6 calibrator dampens multiplier when evidence is insufficient', () => {
    const ws = createWorkspaceId('ws-6')
    const profile: import('../../../domain/entities/ProductAdaptive').AdaptiveLearningProfile = {
      workspaceId: ws,
      projectId: 'proj-1',
      totalDecisionsObserved: 2, // below threshold
      lastCalculatedAt: new Date(),
      PMPreferences: { favoredCategories: [], ignoredCategories: [] },
      categoryCoefficients: [
        {
          category: 'TESTING',
          adoptionRate: 1.0,
          executionSuccessRate: 1.0,
          outcomeVerifiedRate: 1.0,
          pmCalibrationWeight: 0.5, // would normally deflate strongly
        },
      ],
      biasAdjustments: { overPrioritizedLowEffort: false, favoredHighImpact: false },
      calibrationVersion: CALIBRATION_VERSION,
    }
    const signals: import('../../../domain/entities/ProductAdaptive').LearningSignal[] = [
      {
        id: 'sig-1',
        workspaceId: ws,
        projectId: 'proj-1',
        category: 'TESTING',
        type: 'ADOPTION',
        observationCount: 2,
        value: 1.0,
        confidence: 0.2,
        sourceRecommendationIds: [],
        generatedAt: new Date(),
        evidenceState: 'insufficient_evidence',
        calibrationVersion: CALIBRATION_VERSION,
      },
    ]
    const result = calibrator.calibrate(
      {
        id: 'rec-1',
        workspaceId: ws,
        origin: 'insight',
        deduplicationKey: 'k-1',
        title: 'Add automated tests',
        rationale: 'r',
        impact: 'i',
        effort: 'medium',
        priority: 'medium',
        confidence: 0.9,
        insightIds: [],
        findingIds: [],
        proposedActions: [],
        createdAt: new Date(),
        category: 'TESTING',
        pmCategory: 'CRITICAL_PRODUCT_RISK',
        assessment: {
          severity: 'low',
          businessImpact: 'low',
          userImpact: 'low',
          deliveryRisk: 'low',
          operationalRisk: 'low',
          effort: 'low',
          confidence: 0.9,
        },
        priorityScore: 5.0,
        expectedOutcome: '',
        rankingReason: '',
      },
      profile,
      signals
    )
    // multiplier is 1.0 (dampened), outcomeReliabilityMultiplier = 1.0
    expect(result.preferenceMultiplier).toBe(1.0)
    expect(result.outcomeReliabilityMultiplier).toBe(1.0)
    expect(result.calibratedScore).toBe(5.0)
  })

  it('H6 calibrator refuses to fabricate a baseline when priorityScore is missing or invalid', () => {
    // Regression: the calibrator previously computed `priorityScore || 5.0`,
    // silently inventing a baseline whenever the field was falsy. Missing
    // evidence must never be replaced with a fabricated default.
    const ws = createWorkspaceId('ws-6b')
    const recBase = {
      id: 'rec-1',
      workspaceId: ws,
      origin: 'insight' as const,
      deduplicationKey: 'k-1',
      title: 'Add automated tests',
      rationale: 'r',
      impact: 'i',
      effort: 'medium' as const,
      priority: 'medium' as const,
      confidence: 0.9,
      insightIds: [],
      findingIds: [],
      proposedActions: [],
      createdAt: new Date(),
      category: 'TESTING' as const,
      pmCategory: 'CRITICAL_PRODUCT_RISK' as const,
      assessment: {
        severity: 'low' as const,
        businessImpact: 'low' as const,
        userImpact: 'low' as const,
        deliveryRisk: 'low' as const,
        operationalRisk: 'low' as const,
        effort: 'low' as const,
        confidence: 0.9,
      },
      expectedOutcome: '',
      rankingReason: '',
    }

    expect(() =>
      calibrator.calibrate({ ...recBase, priorityScore: undefined as unknown as number }, null, [])
    ).toThrow(/lacks a valid deterministic H3 priorityScore/)
    expect(() => calibrator.calibrate({ ...recBase, priorityScore: 0 }, null, [])).toThrow(
      /lacks a valid deterministic H3 priorityScore/
    )
    expect(() => calibrator.calibrate({ ...recBase, priorityScore: Number.NaN }, null, [])).toThrow(
      /lacks a valid deterministic H3 priorityScore/
    )

    // A valid score still calibrates normally.
    const ok = calibrator.calibrate({ ...recBase, priorityScore: 7.5 }, null, [])
    expect(ok.baseScore).toBe(7.5)
    expect(ok.calibratedScore).toBe(7.5)
  })
})
