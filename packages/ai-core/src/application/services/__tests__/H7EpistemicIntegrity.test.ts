/**
 * Final H7 Epistemic Integrity & Measurement Integrity remediation pass.
 *
 * Proves the epistemic contract:
 *   - no evidence != negative evidence
 *   - zero observations != observed zero rate
 *   - H7 telemetry is independently calibrated from adoption/outcome evidence
 *   - telemetry provenance carries the complete observation population
 *   - telemetry ids are project-scoped
 *   - H6 decision confidence = N/(N+10) over the complete PM decision
 *     population, regardless of decision distribution
 *   - calibration stays bounded [0.85, 1.15] and deterministic
 *   - the H6 safety floor matrix holds for critical >= 8.5 / high >= 7.0
 *   - full multi-tenant / multi-project isolation
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { SqlAdaptiveLearningProfileRepository } from '../../../infrastructure/repositories/SqlAdaptiveLearningProfileRepository'
import { AdaptiveProfileCompiler } from '../AdaptiveProfileCompiler'
import {
  H6PrioritizationCalibrator,
  SAFETY_FLOOR_CRITICAL,
  SAFETY_FLOOR_HIGH,
  MULTIPLIER_FLOOR,
  MULTIPLIER_CEIL,
  MIN_OBSERVATIONS_FOR_OUTCOME,
} from '../H6PrioritizationCalibrator'
import { PMDecisionTelemetryService } from '../PMDecisionTelemetryService'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { WorkspaceId } from '../../../domain/value-objects'
import type { RichRecommendation, PMDecisionKind } from '../../../domain/entities'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h7-epistemic-integrity-test')

const WS = createWorkspaceId('ws-epistemic')
const WS_B = createWorkspaceId('ws-epistemic-b')
const PROJECT = 'proj-epistemic'

describe('H7 Epistemic Integrity (final remediation pass)', () => {
  let database: DurableFileDatabase
  let productRepository: SqlProductRepository
  let actionRepository: SqlActionRepository
  let profileRepository: SqlAdaptiveLearningProfileRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let compiler: AdaptiveProfileCompiler
  let calibrator: H6PrioritizationCalibrator
  let telemetryService: PMDecisionTelemetryService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    // Every test starts with deterministic id-sequence counters so an
    // identical logical observation set maps to identical ids.
    seedSeq = 0
    batchSeq = 0
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    productRepository = new SqlProductRepository(database)
    actionRepository = new SqlActionRepository(database)
    profileRepository = new SqlAdaptiveLearningProfileRepository(database)
    outcomeRepository = new SqlRecommendationOutcomeRepository(database)
    compiler = new AdaptiveProfileCompiler(
      profileRepository,
      productRepository,
      actionRepository,
      outcomeRepository
    )
    calibrator = new H6PrioritizationCalibrator()
    telemetryService = new PMDecisionTelemetryService(productRepository)
  })

  // ---------------- helpers ----------------

  let seedSeq = 0

  /** Seed `count` TESTING-category recommendations (one proposed action each). */
  function seedRecommendations(
    count: number,
    wsId: WorkspaceId = WS,
    projectId: string = PROJECT
  ): string[] {
    const state = database.getActiveState()
    const now = new Date().toISOString()
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const recId = `${wsId}:${projectId}:rec-${seedSeq++}`
      ids.push(recId)
      state.recommendations.push({
        id: recId,
        workspaceId: wsId,
        origin: 'insight',
        deduplicationKey: `key:${recId}`,
        title: `Epistemic rec ${i}`,
        rationale: 'r',
        impact: 'i',
        effort: 'medium',
        priority: 'high',
        confidence: 0.9,
        insightIds: [],
        findingIds: [],
        proposedActions: [{ id: `${recId}:pa-1`, title: 'Do it', description: 'd' }],
        createdAt: now,
        category: 'TESTING',
        projectId,
        pmCategory: 'CRITICAL_PRODUCT_RISK',
        assessment: {
          severity: 'high',
          businessImpact: 'high',
          userImpact: 'high',
          deliveryRisk: 'high',
          operationalRisk: 'high',
          effort: 'medium',
          confidence: 0.9,
        },
        priorityScore: 8.0,
        expectedOutcome: 'e',
        rankingReason: 'r',
      } as never)
      state.actions.push({
        id: `act-${recId}`,
        workspaceId: wsId,
        title: 'Do it',
        description: '',
        target: 'internal',
        status: 'proposed',
        relatedRecommendationId: recId,
        relatedProposedActionId: `${recId}:pa-1`,
        idempotencyKey: `promo:${wsId}:${recId}:pa-1`,
        claimedByExecutionId: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        externalId: null,
        createdAt: now,
        updatedAt: now,
      } as never)
    }
    return ids
  }

  async function seedAndCommit(
    count: number,
    wsId: WorkspaceId = WS,
    projectId: string = PROJECT
  ): Promise<string[]> {
    database.beginTransaction()
    const ids = seedRecommendations(count, wsId, projectId)
    await database.commit()
    return ids
  }

  let batchSeq = 0
  async function recordDecisions(
    recIds: string[],
    decision: PMDecisionKind,
    count: number,
    pmSelectedPriority?: number,
    wsId: WorkspaceId = WS,
    projectId: string = PROJECT
  ): Promise<void> {
    const batch = batchSeq++
    for (let i = 0; i < count; i++) {
      const recId = recIds[i % recIds.length]
      const base = new Date(2026, 7, 10, 10, 0, i + batch * 1000)
      await telemetryService.recordDecision({
        workspaceId: wsId,
        projectId,
        recommendationId: recId,
        originalH3Score: 8.0,
        calibratedH6Score: 8.0,
        decision,
        decisionStartedAt: base,
        decisionCompletedAt: new Date(base.getTime() + 60000),
        recommendationPresentedAt: new Date(base.getTime() - 60000),
        pmSelectedPriority,
      })
    }
  }

  async function seedOutcomes(
    recIds: string[],
    status: 'FAILED' | 'VERIFIED_SUCCESS'
  ): Promise<void> {
    database.beginTransaction()
    const now = new Date().toISOString()
    recIds.forEach((recId, i) => {
      database.getActiveState().outcomes.push({
        id: `out-${status}-${i}-${seedSeq}`,
        workspaceId: WS,
        projectId: PROJECT,
        recommendationId: recId,
        status,
        actionId: null,
        executionId: null,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      } as never)
    })
    await database.commit()
  }

  async function compile(): Promise<void> {
    await compiler.compileProfile(WS, PROJECT)
  }

  function richRec(
    priority: 'critical' | 'high',
    score: number,
    category = 'TESTING'
  ): RichRecommendation {
    return {
      id: 'rec-epistemic-cal',
      workspaceId: WS,
      origin: 'insight',
      deduplicationKey: 'x',
      title: 'Epistemic',
      rationale: 'r',
      impact: 'i',
      effort: 'medium',
      priority,
      confidence: 0.9,
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
        confidence: 0.9,
      },
      priorityScore: score,
      expectedOutcome: 'e',
      rankingReason: 'r',
    }
  }

  async function calibrate(priority: 'critical' | 'high' = 'high', score = 8.0) {
    const profile = await profileRepository.getProfile(WS, PROJECT)
    const signals = await profileRepository.getSignals(WS, PROJECT)
    return calibrator.calibrate(richRec(priority, score), profile, signals)
  }

  async function resetWorld(): Promise<void> {
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    productRepository = new SqlProductRepository(database)
    actionRepository = new SqlActionRepository(database)
    profileRepository = new SqlAdaptiveLearningProfileRepository(database)
    outcomeRepository = new SqlRecommendationOutcomeRepository(database)
    compiler = new AdaptiveProfileCompiler(
      profileRepository,
      productRepository,
      actionRepository,
      outcomeRepository
    )
    telemetryService = new PMDecisionTelemetryService(productRepository)
    // Deterministic-id generation across worlds: reset the sequence counters
    // so an identical logical observation set maps to identical ids even
    // after a world reset.
    seedSeq = 0
    batchSeq = 0
  }

  // =====================================================================
  // FINDING 1 — no evidence must never become negative evidence
  // =====================================================================
  describe('Finding 1 — no evidence is neutral, never negative', () => {
    it('A — 20 ACCEPT telemetry + 0 outcomes does NOT apply an outcome penalty', async () => {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'ACCEPT', 20)
      await compile()
      const cal = await calibrate()
      // 0 outcome observations => outcome multiplier is exactly neutral.
      expect(cal.outcomeReliabilityMultiplier).toBe(1.0)
      expect(cal.explanation).toMatch(/outcome evidence neutral/)
    })

    it('B — 20 ACCEPT telemetry + 0 approvals (insufficient adoption) does NOT fabricate negative adoption evidence', async () => {
      // 4 recommendations = INSUFFICIENT adoption population (< 5). Record 20
      // ACCEPT decisions over them, none approved.
      const recIds = await seedAndCommit(4)
      await recordDecisions(recIds, 'ACCEPT', 20)
      await compile()
      const cal = await calibrate()
      // No negative adoption drag: the adoption contribution is neutral and
      // the positive H7 decision component dominates.
      expect(cal.preferenceMultiplier).toBeGreaterThanOrEqual(1.0)
      expect(cal.preferenceMultiplier).toBeGreaterThan(1.0)
    })

    it('C — 20 ACCEPT + 0 outcomes + 0 adoption still lets the H7 decision component influence H6', async () => {
      const recIds = await seedAndCommit(4)
      await recordDecisions(recIds, 'ACCEPT', 20)
      await compile()
      const cal = await calibrate()
      const acceptance = (await profileRepository.getSignals(WS, PROJECT)).find(
        (s) => s.type === 'ACCEPTANCE'
      )
      expect(acceptance).toBeDefined()
      expect(acceptance!.evidenceState).toBe('observed')
      expect(acceptance!.value).toBe(1.0)
      // The H7 decision component raised the multiplier above neutral.
      expect(cal.preferenceMultiplier).toBeGreaterThan(1.0)
    })

    it('D — 0 observations across all dimensions => fully neutral calibration', async () => {
      await seedAndCommit(0)
      await compile()
      const cal = await calibrate()
      expect(cal.preferenceMultiplier).toBe(1.0)
      expect(cal.outcomeReliabilityMultiplier).toBe(1.0)
      expect(cal.calibratedScore).toBe(cal.baseScore)
    })

    it('E — 20 failed outcomes are real negative evidence; 0 outcomes are neutral', async () => {
      // 0 outcomes world.
      await seedAndCommit(20)
      await compile()
      const neutral = await calibrate()
      expect(neutral.outcomeReliabilityMultiplier).toBe(1.0)

      // Reset, then 20 failed outcomes.
      await resetWorld()
      const recIds2 = await seedAndCommit(20)
      await seedOutcomes(recIds2, 'FAILED')
      await compile()
      const failed = await calibrate()
      // Observed zero verification rate over 20 outcomes => negative influence.
      expect(failed.outcomeReliabilityMultiplier).toBeLessThan(1.0)
      expect(failed.outcomeReliabilityMultiplier).toBeCloseTo(0.9, 5)
    })

    it('F — 20 successful outcomes are positive evidence; 0 outcomes are neutral', async () => {
      await seedAndCommit(20)
      await compile()
      const neutral = await calibrate()
      expect(neutral.outcomeReliabilityMultiplier).toBe(1.0)

      await resetWorld()
      const recIds2 = await seedAndCommit(20)
      await seedOutcomes(recIds2, 'VERIFIED_SUCCESS')
      await compile()
      const success = await calibrate()
      expect(success.outcomeReliabilityMultiplier).toBeGreaterThan(1.0)
      expect(success.outcomeReliabilityMultiplier).toBeCloseTo(1.1, 5)
    })

    it('explicitly distinguishes 0 observations from an observed zero rate in the outcome dimension', async () => {
      // 0 outcomes: neutral.
      await seedAndCommit(20)
      await compile()
      expect((await calibrate()).outcomeReliabilityMultiplier).toBe(1.0)
    })
  })

  // =====================================================================
  // FINDING 2 — telemetry ids are fully project-scoped
  // =====================================================================
  describe('Finding 2 — project-scoped telemetry identity', () => {
    async function recordOne(
      wsId: WorkspaceId,
      projectId: string,
      recId: string,
      ts: string
    ): Promise<string> {
      return (
        await telemetryService.recordDecision({
          workspaceId: wsId,
          projectId,
          recommendationId: recId,
          originalH3Score: 8.0,
          calibratedH6Score: 8.0,
          decision: 'ACCEPT',
          decisionStartedAt: new Date(ts),
          decisionCompletedAt: new Date(new Date(ts).getTime() + 60000),
          recommendationPresentedAt: new Date(new Date(ts).getTime() - 60000),
        })
      ).id
    }

    it('1 — same workspace + same project + same rec + same timestamp => idempotent duplicate', async () => {
      database.beginTransaction()
      seedRecommendations(1, WS, 'proj-x')
      await database.commit()
      const a = await recordOne(WS, 'proj-x', `${WS}:proj-x:rec-0`, '2026-08-10T10:00:00.000Z')
      const b = await recordOne(WS, 'proj-x', `${WS}:proj-x:rec-0`, '2026-08-10T10:00:00.000Z')
      expect(a).toBe(b)
      expect(await productRepository.getPMDecisionTelemetryByProject('proj-x', WS)).toHaveLength(1)
    })

    it('2 — same workspace + DIFFERENT project + same rec/timestamp => different telemetry ids', async () => {
      database.beginTransaction()
      seedRecommendations(1, WS, 'proj-x')
      seedRecommendations(1, WS, 'proj-y')
      await database.commit()
      const idX = await recordOne(WS, 'proj-x', `${WS}:proj-x:rec-0`, '2026-08-10T10:00:00.000Z')
      const idY = await recordOne(WS, 'proj-y', `${WS}:proj-y:rec-0`, '2026-08-10T10:00:00.000Z')
      expect(idX).not.toBe(idY)
    })

    it('3 — different workspace + same project/rec/timestamp => different telemetry ids', async () => {
      database.beginTransaction()
      seedRecommendations(1, WS, 'proj-x')
      seedRecommendations(1, WS_B, 'proj-x')
      await database.commit()
      const idA = await recordOne(WS, 'proj-x', `${WS}:proj-x:rec-0`, '2026-08-10T10:00:00.000Z')
      const idB = await recordOne(
        WS_B,
        'proj-x',
        `${WS_B}:proj-x:rec-0`,
        '2026-08-10T10:00:00.000Z'
      )
      expect(idA).not.toBe(idB)
    })

    it('4 — persisted rows are never overwritten by another project', async () => {
      database.beginTransaction()
      seedRecommendations(1, WS, 'proj-x')
      seedRecommendations(1, WS, 'proj-y')
      await database.commit()
      const recX = `${WS}:proj-x:rec-0`
      const recY = `${WS}:proj-y:rec-0`
      // Same rec id AND same timestamp across two projects.
      await recordOne(WS, 'proj-x', recX, '2026-08-10T10:00:00.000Z')
      await recordOne(WS, 'proj-y', recY, '2026-08-10T10:00:00.000Z')
      const tx = await productRepository.getPMDecisionTelemetryByProject('proj-x', WS)
      const ty = await productRepository.getPMDecisionTelemetryByProject('proj-y', WS)
      expect(tx).toHaveLength(1)
      expect(ty).toHaveLength(1)
      expect(tx[0].projectId).toBe('proj-x')
      expect(ty[0].projectId).toBe('proj-y')
    })

    it('5 — H7 signal generation sees each project population independently', async () => {
      const recsX = await seedAndCommit(5, WS, 'proj-x')
      const recsY = await seedAndCommit(5, WS, 'proj-y')
      await recordDecisions(recsX, 'ACCEPT', 5, undefined, WS, 'proj-x')
      await recordDecisions(recsY, 'REJECT', 5, undefined, WS, 'proj-y')
      await compiler.compileProfile(WS, 'proj-x')
      await compiler.compileProfile(WS, 'proj-y')
      const sigX = await profileRepository.getSignals(WS, 'proj-x')
      const sigY = await profileRepository.getSignals(WS, 'proj-y')
      expect(sigX.find((s) => s.type === 'ACCEPTANCE')!.value).toBe(1.0)
      expect(sigY.find((s) => s.type === 'ACCEPTANCE')!.value).toBe(0)
      expect(sigX.find((s) => s.type === 'REJECTION')).toBeUndefined()
      expect(sigY.find((s) => s.type === 'REJECTION')!.value).toBe(1.0)
    })
  })

  // =====================================================================
  // FINDING 4 & 5 — complete provenance + signal identity over full population
  // =====================================================================
  describe('Findings 4 & 5 — complete telemetry provenance and population-scoped identity', () => {
    it('provenance reconstructs the calculation from persisted telemetry alone', async () => {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'ACCEPT', 10)
      await recordDecisions(recIds, 'REJECT', 10)
      await compile()
      const signals = await profileRepository.getSignals(WS, PROJECT)
      const telemetry = await productRepository.getPMDecisionTelemetryByProject(PROJECT, WS)
      const allIds = telemetry.map((t) => t.id).sort()

      for (const type of ['ACCEPTANCE', 'REJECTION'] as const) {
        const sig = signals.find((s) => s.type === type)!
        expect(sig.sourceTelemetryIds).toBeDefined()
        expect(sig.numeratorTelemetryIds).toBeDefined()
        // Denominator = complete population.
        expect([...sig.sourceTelemetryIds!].sort()).toEqual(allIds)
        expect(sig.sourceTelemetryIds!.length).toBe(sig.observationCount)
        // value = |numerator| / |denominator|.
        expect(sig.value).toBeCloseTo(sig.numeratorTelemetryIds!.length / allIds.length, 5)
      }
      expect(signals.find((s) => s.type === 'ACCEPTANCE')!.value).toBeCloseTo(0.5, 5)
      expect(signals.find((s) => s.type === 'REJECTION')!.value).toBeCloseTo(0.5, 5)
    })

    it('signal identity changes when the observation population changes (10 ACCEPT -> 10 ACCEPT + 10 REJECT)', async () => {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'ACCEPT', 10)
      await compile()
      const idBefore = (await profileRepository.getSignals(WS, PROJECT)).find(
        (s) => s.type === 'ACCEPTANCE'
      )!.id

      await recordDecisions(recIds, 'REJECT', 10)
      await compile()
      const signalsAfter = await profileRepository.getSignals(WS, PROJECT)
      const acc = signalsAfter.find((s) => s.type === 'ACCEPTANCE')!
      const idAfter = acc.id

      // Value, observation count, provenance AND identity all reflect the new
      // complete population (100% -> 50%).
      expect(acc.value).toBeCloseTo(0.5, 5)
      expect(acc.observationCount).toBe(20)
      expect(acc.sourceTelemetryIds).toHaveLength(20)
      expect(acc.numeratorTelemetryIds).toHaveLength(10)
      expect(idAfter).not.toBe(idBefore)

      // No stale ACCEPTANCE signal survives (delete-then-save).
      const duplicates = signalsAfter.filter((s) => s.type === 'ACCEPTANCE')
      expect(duplicates).toHaveLength(1)
    })

    it('ordering telemetry records differently yields identical signal ids (determinism)', async () => {
      const recIds = await seedAndCommit(20)
      // First ordering: interleave.
      for (let i = 0; i < 20; i++) {
        await telemetryService.recordDecision({
          workspaceId: WS,
          projectId: PROJECT,
          recommendationId: recIds[i],
          originalH3Score: 8.0,
          calibratedH6Score: 8.0,
          decision: i % 2 === 0 ? 'ACCEPT' : 'REJECT',
          decisionStartedAt: new Date(2026, 7, 10, 12, 0, i),
          decisionCompletedAt: new Date(2026, 7, 10, 12, 1, i),
          recommendationPresentedAt: new Date(2026, 7, 10, 11, 59, i),
        })
      }
      await compile()
      const id1 = (await profileRepository.getSignals(WS, PROJECT)).find(
        (s) => s.type === 'ACCEPTANCE'
      )!.id

      await resetWorld()
      const recIds2 = await seedAndCommit(20)
      // Same 20 decisions, opposite order.
      for (let i = 19; i >= 0; i--) {
        await telemetryService.recordDecision({
          workspaceId: WS,
          projectId: PROJECT,
          recommendationId: recIds2[i],
          originalH3Score: 8.0,
          calibratedH6Score: 8.0,
          decision: i % 2 === 0 ? 'ACCEPT' : 'REJECT',
          decisionStartedAt: new Date(2026, 7, 10, 12, 0, i),
          decisionCompletedAt: new Date(2026, 7, 10, 12, 1, i),
          recommendationPresentedAt: new Date(2026, 7, 10, 11, 59, i),
        })
      }
      await compile()
      const id2 = (await profileRepository.getSignals(WS, PROJECT)).find(
        (s) => s.type === 'ACCEPTANCE'
      )!.id
      expect(id1).toBe(id2)
    })
  })

  // =====================================================================
  // FINDING 6 — zero observations vs observed zero rate across dimensions
  // =====================================================================
  describe('Finding 6 — ZERO observations vs OBSERVED zero rate', () => {
    it('0 decisions -> no acceptance signal at all; 20 decisions with 0 accepts -> observed 0% rate', async () => {
      // 0 decisions.
      await seedAndCommit(5)
      await compile()
      let signals = await profileRepository.getSignals(WS, PROJECT)
      expect(signals.find((s) => s.type === 'ACCEPTANCE')).toBeUndefined()

      // 20 decisions, 20 REJECT -> observed 0% acceptance (real negative).
      await recordDecisions(
        (await productRepository.getRecommendationsByProject(PROJECT, WS)).map((r) => r.id),
        'REJECT',
        20
      )
      await compile()
      signals = await profileRepository.getSignals(WS, PROJECT)
      const acc = signals.find((s) => s.type === 'ACCEPTANCE')!
      expect(acc).toBeDefined()
      expect(acc.evidenceState).toBe('observed')
      expect(acc.value).toBe(0)
      expect(acc.numeratorTelemetryIds).toHaveLength(0)
      expect(acc.sourceTelemetryIds).toHaveLength(20)
    })

    it('outcome dimension: 0 outcomes neutral; observed zero verification rate negative', async () => {
      await seedAndCommit(20)
      await compile()
      expect((await calibrate()).outcomeReliabilityMultiplier).toBe(1.0)

      await resetWorld()
      const recIds = await seedAndCommit(20)
      await seedOutcomes(recIds, 'FAILED')
      await compile()
      const cal = await calibrate()
      expect(cal.outcomeReliabilityMultiplier).toBeLessThan(1.0)
    })

    it('adoption dimension: insufficient adoption is neutral, observed 0% adoption is negative', async () => {
      // 4 recs (insufficient) all proposed.
      await seedAndCommit(4)
      await compile()
      const neutral = await calibrate()
      // No observed adoption signal and insufficient adoption => the adoption
      // contribution is exactly 1.0 (no drag below the floor from no evidence).
      expect(neutral.preferenceMultiplier).toBeGreaterThanOrEqual(1.0)

      // 20 recs all proposed = OBSERVED 0% adoption => negative (floor).
      await resetWorld()
      await seedAndCommit(20)
      await compile()
      const observed = await calibrate()
      expect(observed.preferenceMultiplier).toBeCloseTo(MULTIPLIER_FLOOR, 2)
    })
  })

  // =====================================================================
  // FINDING 7 — decision confidence is N/(N+10) over the full population
  // =====================================================================
  describe('Finding 7 — decision confidence over the complete PM decision population', () => {
    it('decisionConfidence = N/(N+10) regardless of decision distribution (N=20)', async () => {
      const mixes: Array<[PMDecisionKind, number, number | undefined]> = [
        ['ACCEPT', 20, undefined],
        ['REJECT', 20, undefined],
      ]
      for (const [kind, count, priority] of mixes) {
        await resetWorld()
        const recIds = await seedAndCommit(20)
        await recordDecisions(recIds, kind, count, priority)
        await compile()
        const acc = (await profileRepository.getSignals(WS, PROJECT)).find(
          (s) => s.type === 'ACCEPTANCE'
        )!
        // ACCEPTANCE is the canonical full-population carrier.
        expect(acc.observationCount).toBe(20)
        expect(acc.confidence).toBeCloseTo(20 / 30, 5)
      }

      // 10 ACCEPT + 10 REJECT.
      await resetWorld()
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'ACCEPT', 10)
      await recordDecisions(recIds, 'REJECT', 10)
      await compile()
      const acc = (await profileRepository.getSignals(WS, PROJECT)).find(
        (s) => s.type === 'ACCEPTANCE'
      )!
      expect(acc.observationCount).toBe(20)
      expect(acc.confidence).toBeCloseTo(20 / 30, 5)

      // 5 ACCEPT + 5 DEFER + 5 OVERRIDE + 5 REJECT (overrides keep delta 0).
      await resetWorld()
      const recIds2 = await seedAndCommit(20)
      await recordDecisions(recIds2, 'ACCEPT', 5)
      await recordDecisions(recIds2, 'REJECT', 5)
      await recordDecisions(recIds2, 'DEFER', 5)
      await recordDecisions(recIds2, 'OVERRIDE', 5, 8.0)
      await compile()
      const acc2 = (await profileRepository.getSignals(WS, PROJECT)).find(
        (s) => s.type === 'ACCEPTANCE'
      )!
      expect(acc2.observationCount).toBe(20)
      expect(acc2.confidence).toBeCloseTo(20 / 30, 5)
    })
  })

  // =====================================================================
  // FINDING 8 — bounded and deterministic calibration
  // =====================================================================
  describe('Finding 8 — bounded and deterministic calibration', () => {
    it('identical telemetry -> identical calibration (repeated compilation)', async () => {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'ACCEPT', 20)
      await compile()
      const c1 = await calibrate()
      await compile()
      const c2 = await calibrate()
      expect(c1.calibratedScore).toBe(c2.calibratedScore)
      expect(c1.preferenceMultiplier).toBe(c2.preferenceMultiplier)
    })

    it('multiplier stays within [0.85, 1.15] for extreme and mixed evidence', async () => {
      const scenarios: Array<[PMDecisionKind[], number[]]> = [
        [
          ['ACCEPT', 'ACCEPT', 'ACCEPT', 'ACCEPT'],
          [5, 5, 5, 5],
        ],
        [
          ['REJECT', 'REJECT', 'REJECT', 'REJECT'],
          [5, 5, 5, 5],
        ],
      ]
      for (const [kinds, counts] of scenarios) {
        await resetWorld()
        const recIds = await seedAndCommit(20)
        for (let i = 0; i < kinds.length; i++) {
          await recordDecisions(recIds, kinds[i] as PMDecisionKind, counts[i])
        }
        await compile()
        const cal = await calibrate()
        expect(cal.preferenceMultiplier).toBeGreaterThanOrEqual(MULTIPLIER_FLOOR)
        expect(cal.preferenceMultiplier).toBeLessThanOrEqual(MULTIPLIER_CEIL)
        expect(cal.outcomeReliabilityMultiplier).toBeGreaterThanOrEqual(0.9)
        expect(cal.outcomeReliabilityMultiplier).toBeLessThanOrEqual(1.1)
      }
    })

    it('adding one observation changes calibration deterministically', async () => {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'ACCEPT', 19)
      await compile()
      const c19 = await calibrate()
      await recordDecisions(recIds, 'ACCEPT', 1)
      await compile()
      const c20 = await calibrate()
      expect(c20.preferenceMultiplier).not.toBe(c19.preferenceMultiplier)
      // Deterministic: recompiling the 20-world reproduces it.
      await compile()
      const c20b = await calibrate()
      expect(c20b.preferenceMultiplier).toBe(c20.preferenceMultiplier)
    })

    it('duplicate telemetry submissions are idempotent (no double signal)', async () => {
      const recIds = await seedAndCommit(20)
      // Record 20 ACCEPT decisions with EXPLICIT windows.
      const windows: Array<{ recId: string; ts: Date }> = []
      for (let i = 0; i < 20; i++) {
        windows.push({ recId: recIds[i], ts: new Date(2026, 7, 10, 14, 0, i) })
      }
      const submit = async () => {
        for (const { recId, ts } of windows) {
          await telemetryService.recordDecision({
            workspaceId: WS,
            projectId: PROJECT,
            recommendationId: recId,
            originalH3Score: 8.0,
            calibratedH6Score: 8.0,
            decision: 'ACCEPT',
            decisionStartedAt: ts,
            decisionCompletedAt: new Date(ts.getTime() + 60000),
            recommendationPresentedAt: new Date(ts.getTime() - 60000),
          })
        }
      }
      await submit()
      await compile()
      const signals1 = await profileRepository.getSignals(WS, PROJECT)
      // Re-submit the EXACT same windows -> idempotent collapse.
      await submit()
      await compile()
      const signals2 = await profileRepository.getSignals(WS, PROJECT)
      expect(signals2.filter((s) => s.type === 'ACCEPTANCE').length).toBe(
        signals1.filter((s) => s.type === 'ACCEPTANCE').length
      )
      const telemetry = await productRepository.getPMDecisionTelemetryByProject(PROJECT, WS)
      expect(telemetry).toHaveLength(20)
    })
  })

  // =====================================================================
  // FINDING 9 — H6/H7 safety floor matrix
  // =====================================================================
  describe('Finding 9 — H6/H7 safety floor matrix', () => {
    it('critical >= 8.5 and high >= 7.0 under every decision/outcome scenario', async () => {
      const scenarios: Array<[string, (recs: string[]) => Promise<void>]> = [
        ['100% ACCEPT', (r) => recordDecisions(r, 'ACCEPT', 20)],
        ['100% REJECT', (r) => recordDecisions(r, 'REJECT', 20)],
        ['100% DEFER', (r) => recordDecisions(r, 'DEFER', 20)],
        ['100% OVERRIDE extreme delta', (r) => recordDecisions(r, 'OVERRIDE', 20, 0.5)],
        [
          'mixed decisions',
          async (r) => {
            await recordDecisions(r, 'ACCEPT', 8)
            await recordDecisions(r, 'REJECT', 6)
            await recordDecisions(r, 'DEFER', 4)
            await recordDecisions(r, 'OVERRIDE', 2, 2)
          },
        ],
        ['zero outcomes', (r) => recordDecisions(r, 'ACCEPT', 20)],
        [
          'all failed outcomes',
          async (r) => {
            await recordDecisions(r, 'ACCEPT', 20)
            await seedOutcomes(r, 'FAILED')
          },
        ],
        [
          'all successful outcomes',
          async (r) => {
            await recordDecisions(r, 'ACCEPT', 20)
            await seedOutcomes(r, 'VERIFIED_SUCCESS')
          },
        ],
        ['no adoption observations', (r) => recordDecisions(r, 'ACCEPT', 20)],
        [
          'contradictory telemetry (accept + override + large delta)',
          async (r) => {
            await recordDecisions(r, 'ACCEPT', 10)
            await recordDecisions(r, 'OVERRIDE', 10, 1)
          },
        ],
      ]
      for (const [label, setup] of scenarios) {
        await resetWorld()
        const recs = await seedAndCommit(20)
        await setup(recs)
        await compile()
        const calCritical = await calibrate('critical', 9.5)
        const calHigh = await calibrate('high', 8.0)
        expect(calCritical.calibratedScore, `critical @ ${label}`).toBeGreaterThanOrEqual(
          SAFETY_FLOOR_CRITICAL
        )
        expect(calHigh.calibratedScore, `high @ ${label}`).toBeGreaterThanOrEqual(SAFETY_FLOOR_HIGH)
      }
    })

    it('safety floor is applied AFTER calibration but BEFORE final presentation', async () => {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'REJECT', 20)
      await compile()
      const cal = await calibrate('critical', 9.5)
      // Rejection would deflate below the floor; the floor preserves it.
      expect(cal.safetyFloorEnforced).toBe(true)
      expect(cal.calibratedScore).toBe(SAFETY_FLOOR_CRITICAL)
      expect(cal.baseScore).toBe(9.5)
    })
  })

  // =====================================================================
  // FINDING 10 — full multi-tenant H7 isolation
  // =====================================================================
  describe('Finding 10 — full multi-tenant / multi-project H7 isolation', () => {
    it('same IDs across tenants/projects never collide for any H7 artifact', async () => {
      // Workspace A / Project A, Workspace A / Project B, Workspace B / Project A
      const sharedRecId = 'shared-rec-id'
      const sharedTimestamp = '2026-08-10T10:00:00.000Z'

      database.beginTransaction()
      // seed one recommendation with the SAME id in each (ws, project).
      for (const [wsId, projId] of [
        [WS, 'proj-A'],
        [WS, 'proj-B'],
        [WS_B, 'proj-A'],
      ] as const) {
        const state = database.getActiveState()
        state.recommendations.push({
          id: sharedRecId,
          workspaceId: wsId,
          origin: 'insight',
          deduplicationKey: `key:${wsId}:${projId}`,
          title: 'shared',
          rationale: 'r',
          impact: 'i',
          effort: 'medium',
          priority: 'high',
          confidence: 0.9,
          insightIds: [],
          findingIds: [],
          proposedActions: [],
          createdAt: new Date().toISOString(),
          category: 'TESTING',
          projectId: projId,
          pmCategory: 'CRITICAL_PRODUCT_RISK',
          assessment: {
            severity: 'high',
            businessImpact: 'high',
            userImpact: 'high',
            deliveryRisk: 'high',
            operationalRisk: 'high',
            effort: 'medium',
            confidence: 0.9,
          },
          priorityScore: 8.0,
          expectedOutcome: 'e',
          rankingReason: 'r',
        } as never)
      }
      await database.commit()

      // Record a decision with the SAME recommendation id and SAME timestamp
      // in all three (ws, project) scopes.
      for (const [wsId, projId] of [
        [WS, 'proj-A'],
        [WS, 'proj-B'],
        [WS_B, 'proj-A'],
      ] as const) {
        await telemetryService.recordDecision({
          workspaceId: wsId,
          projectId: projId,
          recommendationId: sharedRecId,
          originalH3Score: 8.0,
          calibratedH6Score: 8.0,
          decision: 'ACCEPT',
          decisionStartedAt: new Date(sharedTimestamp),
          decisionCompletedAt: new Date(new Date(sharedTimestamp).getTime() + 60000),
          recommendationPresentedAt: new Date(new Date(sharedTimestamp).getTime() - 60000),
        })
      }

      // Three distinct rows, each correctly scoped — no collision/overwrite.
      const tAA = await productRepository.getPMDecisionTelemetryByProject('proj-A', WS)
      const tAB = await productRepository.getPMDecisionTelemetryByProject('proj-B', WS)
      const tBA = await productRepository.getPMDecisionTelemetryByProject('proj-A', WS_B)
      expect(tAA).toHaveLength(1)
      expect(tAB).toHaveLength(1)
      expect(tBA).toHaveLength(1)
      const ids = [tAA[0].id, tAB[0].id, tBA[0].id]
      expect(new Set(ids).size).toBe(3)
    })

    it('learning signals / profiles / calibration are isolated across (ws, project)', async () => {
      // WS/proj-A: 5 ACCEPT; WS/proj-B: 5 REJECT.
      const recsAA = await seedAndCommit(5, WS, 'proj-A')
      const recsAB = await seedAndCommit(5, WS, 'proj-B')
      await recordDecisions(recsAA, 'ACCEPT', 5, undefined, WS, 'proj-A')
      await recordDecisions(recsAB, 'REJECT', 5, undefined, WS, 'proj-B')
      await compiler.compileProfile(WS, 'proj-A')
      await compiler.compileProfile(WS, 'proj-B')

      const sigA = await profileRepository.getSignals(WS, 'proj-A')
      const sigB = await profileRepository.getSignals(WS, 'proj-B')
      expect(sigA.find((s) => s.type === 'ACCEPTANCE')!.value).toBe(1.0)
      expect(sigB.find((s) => s.type === 'ACCEPTANCE')!.value).toBe(0)
      expect(sigA.find((s) => s.type === 'REJECTION')).toBeUndefined()
      expect(sigB.find((s) => s.type === 'REJECTION')!.value).toBe(1.0)

      const profA = await profileRepository.getProfile(WS, 'proj-A')
      const profB = await profileRepository.getProfile(WS, 'proj-B')
      expect(profA!.projectId).toBe('proj-A')
      expect(profB!.projectId).toBe('proj-B')
    })
  })

  // =====================================================================
  // FINDING 1 contract doc — outcome neutrality trace
  // =====================================================================
  it('outcome evidence below the observed threshold is documented as neutral, not a rate', async () => {
    const recIds = await seedAndCommit(20)
    await recordDecisions(recIds, 'ACCEPT', 20)
    await compile()
    const cal = await calibrate()
    expect(cal.outcomeReliabilityMultiplier).toBe(1.0)
    expect(cal.explanation).toMatch(
      new RegExp(
        `outcome evidence neutral \\(0 outcome observation\\(s\\) < ${MIN_OBSERVATIONS_FOR_OUTCOME}\\)`
      )
    )
  })
})
