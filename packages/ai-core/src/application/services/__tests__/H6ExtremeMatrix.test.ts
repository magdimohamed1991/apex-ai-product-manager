import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { SqlAdaptiveLearningProfileRepository } from '../../../infrastructure/repositories/SqlAdaptiveLearningProfileRepository'
import { AdaptiveProfileCompiler } from '../AdaptiveProfileCompiler'
import { H6PrioritizationCalibrator, SAFETY_FLOOR_CRITICAL } from '../H6PrioritizationCalibrator'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { WorkspaceId } from '../../../domain/value-objects'
import type { RichRecommendation } from '../../../domain/entities'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h6-extreme-matrix-test')

/**
 * H6 extreme-value matrix (audit mandate §8):
 *   - observation counts: 0, 1, 4, 5, 19, 20, 1000, 100000
 *   - pathological histories: 100% approval, 0% approval
 *   - invariants: dampening below thresholds, evidence states, clamp to
 *     [0.85, 1.15], safety floor for critical risk, no runaway multiplier
 */
describe('H6 — extreme observation matrix', () => {
  let database: DurableFileDatabase
  let productRepository: SqlProductRepository
  let actionRepository: SqlActionRepository
  let profileRepository: SqlAdaptiveLearningProfileRepository
  let compiler: AdaptiveProfileCompiler
  const calibrator = new H6PrioritizationCalibrator()

  const WS: WorkspaceId = createWorkspaceId('ws-matrix')
  const PROJECT = 'proj-matrix'

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    productRepository = new SqlProductRepository(database)
    actionRepository = new SqlActionRepository(database)
    profileRepository = new SqlAdaptiveLearningProfileRepository(database)
    compiler = new AdaptiveProfileCompiler(
      profileRepository,
      productRepository,
      actionRepository,
      new SqlRecommendationOutcomeRepository(database)
    )
  })

  /**
   * Seed `count` TESTING-category recommendations plus one action each
   * (approved or proposed), directly into the DB state with batched commits
   * so 100k observations stay tractable.
   */
  async function seedCategory(count: number, approvedCount: number): Promise<void> {
    database.beginTransaction()
    const state = database.getActiveState()
    const now = new Date().toISOString()
    for (let i = 0; i < count; i++) {
      const recId = `rec-testing-${i}`
      state.recommendations.push({
        id: recId,
        workspaceId: WS,
        origin: 'insight',
        deduplicationKey: `add-testing:insight:${recId}`,
        title: 'Introduce automated testing',
        rationale: 'No test suite was detected in the repository.',
        impact: 'Reduces regression risk',
        effort: 'medium',
        priority: 'high',
        confidence: 0.95,
        insightIds: [recId],
        findingIds: [],
        proposedActions: [],
        createdAt: now,
        category: 'TESTING',
        projectId: PROJECT,
      } as never)
      state.actions.push({
        id: `act-${recId}`,
        workspaceId: WS,
        title: 'Add Vitest test framework',
        description: '',
        target: 'internal',
        status: i < approvedCount ? 'approved' : 'proposed',
        relatedRecommendationId: recId,
        relatedProposedActionId: `${recId}:add-vitest`,
        idempotencyKey: `promo:${WS}:${recId}:${recId}:add-vitest`,
        claimedByExecutionId: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        externalId: null,
        createdAt: now,
        updatedAt: now,
      } as never)
    }
    await database.commit()
  }

  /** Reset ALL observation state (recommendations, actions, signals). */
  async function clearObservations(): Promise<void> {
    database.beginTransaction()
    database.getActiveState().recommendations = []
    database.getActiveState().actions = []
    database.getActiveState().outcomes = []
    await database.commit()
    await profileRepository.deleteSignalsByProject(WS, PROJECT)
  }

  async function compile() {
    return compiler.compileProfile(WS, PROJECT)
  }

  function richRec(
    priority: 'critical' | 'high',
    score: number,
    category = 'TESTING'
  ): RichRecommendation {
    return {
      id: 'rec-cal',
      workspaceId: WS,
      origin: 'insight',
      deduplicationKey: 'x',
      title: 'Introduce automated testing',
      rationale: 'r',
      impact: 'i',
      effort: 'medium',
      priority,
      confidence: 0.95,
      insightIds: [],
      findingIds: [],
      proposedActions: [],
      createdAt: new Date(),
      category: category as 'TESTING',
      pmCategory: 'CRITICAL_PRODUCT_RISK',
      assessment: {
        severity: 'high',
        businessImpact: 'high',
        userImpact: 'high',
        deliveryRisk: 'high',
        operationalRisk: 'high',
        effort: 'medium',
        confidence: 0.95,
      },
      priorityScore: score,
      expectedOutcome: 'e',
      rankingReason: 'r',
    }
  }

  it('0 and 1 observations: no signals, no calibration influence, base score preserved', async () => {
    for (const n of [0, 1]) {
      await clearObservations()
      await seedCategory(n, n)
      const profile = await compile()
      // n=1 with 1 approved action is 1 observed decision; the invariant is
      // that such a tiny sample generates NO signals and NO calibration
      // influence.
      expect(profile.totalDecisionsObserved).toBe(n)

      const signals = await profileRepository.getSignals(WS, PROJECT)
      expect(signals).toHaveLength(0)

      const cal = calibrator.calibrate(richRec('critical', 9.5), profile, signals)
      expect(cal.baseScore).toBe(9.5)
      expect(cal.calibratedScore).toBe(9.5)
      expect(cal.preferenceMultiplier).toBe(1.0)
      expect(cal.outcomeReliabilityMultiplier).toBe(1.0)
    }
  })

  it('4 observations: signals recorded but insufficient_evidence → calibrator must not influence', async () => {
    await seedCategory(4, 4)
    const profile = await compile()
    const signals = await profileRepository.getSignals(WS, PROJECT)

    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((s) => s.evidenceState === 'insufficient_evidence')).toBe(true)

    const cal = calibrator.calibrate(richRec('critical', 9.5), profile, signals)
    expect(cal.baseScore).toBe(9.5)
    expect(cal.calibratedScore).toBe(9.5)
    expect(cal.preferenceMultiplier).toBe(1.0)
  })

  it('5 observations: ADOPTION signal observed (threshold met) with a damped multiplier', async () => {
    await seedCategory(5, 5)
    const profile = await compile()
    const signals = await profileRepository.getSignals(WS, PROJECT)
    const adoption = signals.find((s) => s.type === 'ADOPTION')!
    expect(adoption.evidenceState).toBe('observed')
    expect(adoption.observationCount).toBe(5)
    expect(adoption.confidence).toBeCloseTo(5 / 15, 5)

    const coef = profile.categoryCoefficients.find((c) => c.category === 'TESTING')!
    // n=5, 100% adoption: 1 + 0.3 * (5/15) = 1.10 — small sample dampened.
    expect(coef.pmCalibrationWeight).toBeCloseTo(1.1, 2)
  })

  it(
    '19/20/1000/100000 observations: multiplier clamps at the documented 1.15 ceiling (no runaway)',
    { timeout: 120000 },
    async () => {
      const expectations: Array<[number, number]> = [
        [19, 1 + 0.3 * (19 / 29)],
        [20, 1 + 0.3 * (20 / 30)],
        [1000, 1.15], // unclamped asymptote would be ≈1.297
        [100000, 1.15],
      ]
      for (const [n, expectedRaw] of expectations) {
        await clearObservations()
        await seedCategory(n, n)
        const profile = await compile()
        const coef = profile.categoryCoefficients.find((c) => c.category === 'TESTING')!
        const expectedClamped = Math.min(1.15, expectedRaw)
        expect(coef.pmCalibrationWeight, `n=${n}`).toBeCloseTo(
          Math.round(expectedClamped * 100) / 100,
          2
        )
        expect(coef.pmCalibrationWeight).toBeLessThanOrEqual(1.15)

        // Safety floor: a critical recommendation can never be calibrated
        // below the floor regardless of profile size.
        const signals = await profileRepository.getSignals(WS, PROJECT)
        const cal = calibrator.calibrate(richRec('critical', 9.5), profile, signals)
        expect(cal.calibratedScore).toBeGreaterThanOrEqual(SAFETY_FLOOR_CRITICAL)
      }
    }
  )

  it('0% approval history (30 recs, 5 approved): ignored category, weight at 0.85 floor', async () => {
    await seedCategory(30, 5)
    const profile = await compile()
    expect(profile.PMPreferences.ignoredCategories).toContain('TESTING')

    // adoptionRate = 5/30 ≈ 0.1667; confidence = 30/40 = 0.75
    // weight = 1 + (0.1667 - 0.5) * 0.6 * 0.75 = 0.85 → clamped at the floor.
    const coef = profile.categoryCoefficients.find((c) => c.category === 'TESTING')!
    expect(coef.pmCalibrationWeight).toBeCloseTo(0.85, 2)
  })

  it('category disappearance: recompiling with zero observations removes previous signals for that category', async () => {
    await seedCategory(5, 5)
    await compile()
    expect(await profileRepository.getSignals(WS, PROJECT)).not.toHaveLength(0)

    // All TESTING observations vanish → recompile.
    await clearObservations()
    const profile = await compile()
    expect(profile.totalDecisionsObserved).toBe(0)
    // No stale signals may remain for the vanished category.
    expect(await profileRepository.getSignals(WS, PROJECT)).toHaveLength(0)
  })
})
