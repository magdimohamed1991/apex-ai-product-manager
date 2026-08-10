/**
 * H7 → H6 Learning Effect Tests (Final remediation pass)
 *
 * These tests prove the COMPLETE causal loop, not just "telemetry exists":
 *
 *   real PM decisions → real H7 telemetry → auditable H7 signals →
 *   bounded H6 calibration → observable change in prioritization
 *
 * Scenarios (mission §7):
 *   A — strong acceptance changes calibration deterministically
 *   B — systematic rejection responds per the bounded rule
 *   C — systematic override (consistent priority delta) is consumed
 *   D — mixed behavior (40/30/20/10) yields deterministic calibration
 *   E — insufficient evidence (1–4 observations) → no meaningful shift
 *   F — convergence boundary (N = 4 / 5 / 19 / 20)
 *   G — contradictory signals (high acceptance + high override + large
 *       delta) stay bounded and explainable — never blind preference
 *
 * Safety floors (§9): 100% rejection / 100% defer / 100% override /
 * extreme override delta / zero outcomes / failed outcomes / mixed
 * signals can never erase objective risk (critical >= 8.5, high >= 7.0).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { SqlAdaptiveLearningProfileRepository } from '../../../infrastructure/repositories/SqlAdaptiveLearningProfileRepository'
import { AdaptiveProfileCompiler, CALIBRATION_VERSION } from '../AdaptiveProfileCompiler'
import {
  H6PrioritizationCalibrator,
  SAFETY_FLOOR_CRITICAL,
  SAFETY_FLOOR_HIGH,
  MULTIPLIER_FLOOR,
  MULTIPLIER_CEIL,
  H7_DECISION_ADJUSTMENT_MAX,
  H7_OVERRIDE_DELTA_ADJUSTMENT_MAX,
} from '../H6PrioritizationCalibrator'
import { PMDecisionTelemetryService } from '../PMDecisionTelemetryService'
import { ProductValidationService } from '../ProductValidationService'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { RichRecommendation, PMDecisionKind } from '../../../domain/entities'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h7-learning-effect-test')

const WS = createWorkspaceId('ws-effect')
const PROJECT = 'proj-effect'

describe('H7 → H6 Learning Effect (telemetry MUST change calibration)', () => {
  let database: DurableFileDatabase
  let productRepository: SqlProductRepository
  let actionRepository: SqlActionRepository
  let profileRepository: SqlAdaptiveLearningProfileRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let compiler: AdaptiveProfileCompiler
  let calibrator: H6PrioritizationCalibrator
  let telemetryService: PMDecisionTelemetryService
  let validationService: ProductValidationService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
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
    validationService = new ProductValidationService(
      productRepository,
      actionRepository,
      outcomeRepository
    )
  })

  // ---------- helpers ----------

  /** Seed `count` TESTING-category recommendations (with one action each, proposed). */
  function seedRecommendations(count: number, wsId = WS, projectId = PROJECT): void {
    const state = database.getActiveState()
    const now = new Date().toISOString()
    for (let i = 0; i < count; i++) {
      const recId = `${wsId}-rec-${projectId}-${i}`
      state.recommendations.push({
        id: recId,
        workspaceId: wsId,
        origin: 'insight',
        deduplicationKey: `key:${recId}`,
        title: `Effect rec ${i}`,
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
  }

  async function seedAndCommit(count: number, wsId = WS, projectId = PROJECT): Promise<string[]> {
    database.beginTransaction()
    seedRecommendations(count, wsId, projectId)
    await database.commit()
    const state = database.getActiveState()
    const rows = state.recommendations as unknown as Array<{
      id: string
      workspaceId: string
      projectId: string
    }>
    return rows.filter((r) => r.workspaceId === wsId && r.projectId === projectId).map((r) => r.id)
  }

  /**
   * Record `count` telemetry decisions of the given kind over the given rec
   * ids. For OVERRIDE, `pmSelectedPriority` supplies the numeric priority.
   * Every batch uses a UNIQUE time offset so decision windows never collide
   * (the deterministic telemetry id hashes workspaceId + recommendationId +
   * decisionStartedAt — repeated windows would collapse into duplicates).
   */
  let recordBatchSeq = 0
  async function recordDecisions(
    recIds: string[],
    decision: PMDecisionKind,
    count: number,
    pmSelectedPriority?: number
  ): Promise<void> {
    const batch = recordBatchSeq++
    for (let i = 0; i < count; i++) {
      const recId = recIds[i % recIds.length]
      const base = new Date(2026, 7, 9, 10, 0, i + batch * 1000)
      await telemetryService.recordDecision({
        workspaceId: WS,
        projectId: PROJECT,
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

  async function compile() {
    return compiler.compileProfile(WS, PROJECT)
  }

  function richRec(
    priority: 'critical' | 'high',
    score: number,
    category = 'TESTING'
  ): RichRecommendation {
    return {
      id: 'rec-effect-cal',
      workspaceId: WS,
      origin: 'insight',
      deduplicationKey: 'x',
      title: 'Effect',
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

  /** Calibrate a high-priority 8.0 rec against the compiled profile+signals. */
  async function calibrateHigh80() {
    const profile = await profileRepository.getProfile(WS, PROJECT)
    const signals = await profileRepository.getSignals(WS, PROJECT)
    return calibrator.calibrate(richRec('high', 8.0), profile, signals)
  }

  /** Flip every project action to `approved` (adoption = 100%). */
  function approveAllActions(wsId = WS, projectId = PROJECT): void {
    const state = database.getActiveState()
    const rows = state.recommendations as unknown as Array<{
      id: string
      workspaceId: string
      projectId: string
    }>
    const recIds = new Set(
      rows.filter((r) => r.workspaceId === wsId && r.projectId === projectId).map((r) => r.id)
    )
    for (const a of state.actions) {
      if (a.workspaceId === wsId && recIds.has(a.relatedRecommendationId as string)) {
        a.status = 'approved'
      }
    }
  }

  /** Wipe the durable DB and rebuild every repository (fresh world). */
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
    validationService = new ProductValidationService(
      productRepository,
      actionRepository,
      outcomeRepository
    )
  }

  function decisionSignals(
    signals: import('../../../domain/entities/ProductAdaptive').LearningSignal[]
  ) {
    return signals.filter((s) =>
      ['ACCEPTANCE', 'REJECTION', 'DEFER', 'OVERRIDE', 'PRIORITY_OVERRIDE_DELTA'].includes(s.type)
    )
  }

  // ---------- Scenario A: strong acceptance ----------

  it('A — strong ACCEPT telemetry changes calibration deterministically vs no telemetry', async () => {
    const recIds = await seedAndCommit(20)

    // Baseline: compile + calibrate with NO telemetry (adoption 0 → weight floor).
    await compile()
    const baseline = await calibrateHigh80()
    expect(baseline.preferenceMultiplier).toBeCloseTo(MULTIPLIER_FLOOR, 2)

    // Record 20 ACCEPT decisions (full telemetry population: 100% acceptance).
    await recordDecisions(recIds, 'ACCEPT', 20)

    await compile()
    const after = await calibrateHigh80()

    // The ACCEPTANCE signal exists, observed, from the telemetry population.
    const signals = await profileRepository.getSignals(WS, PROJECT)
    const acc = signals.find((s) => s.type === 'ACCEPTANCE')
    expect(acc).toBeDefined()
    expect(acc!.observationCount).toBe(20)
    expect(acc!.value).toBe(1.0) // 20/20
    expect(acc!.evidenceState).toBe('observed')
    expect(acc!.sourceTelemetryIds).toHaveLength(20)

    // Telemetry changes the calibration deterministically: 100% acceptance
    // must push the multiplier strictly above the no-telemetry baseline.
    expect(after.preferenceMultiplier).toBeGreaterThan(baseline.preferenceMultiplier)
    expect(after.preferenceMultiplier).toBeLessThanOrEqual(MULTIPLIER_CEIL)
    expect(after.calibratedScore).toBeGreaterThan(baseline.calibratedScore)
    expect(after.calibrationVersion).toBe(CALIBRATION_VERSION)
    expect(after.explanation).toMatch(/H7 decision evidence over 20 telemetry decision\(s\)/)
  })

  // ---------- Scenario B: systematic rejection ----------

  it('B — systematic REJECT telemetry responds per the bounded rule', async () => {
    const recIds = await seedAndCommit(20)
    await recordDecisions(recIds, 'REJECT', 20)

    await compile()
    const cal = await calibrateHigh80()

    const signals = await profileRepository.getSignals(WS, PROJECT)
    const rej = signals.find((s) => s.type === 'REJECTION')
    expect(rej).toBeDefined()
    expect(rej!.value).toBe(1.0) // 20/20 rejections
    expect(rej!.evidenceState).toBe('observed')
    expect(rej!.sourceTelemetryIds).toHaveLength(20)

    // 100% rejection → valence = -1 → multiplier at the documented floor.
    expect(cal.preferenceMultiplier).toBeCloseTo(MULTIPLIER_FLOOR, 2)
    expect(cal.preferenceMultiplier).toBeGreaterThanOrEqual(MULTIPLIER_FLOOR)
    // Bounded: the floor is the worst case — never below it.
    expect(cal.explanation).toMatch(/REJECT 100%/)
  })

  // ---------- Scenario C: systematic override with consistent delta ----------

  it('C — systematic OVERRIDE with a consistent priority delta is consumed by H6', async () => {
    const recIds = await seedAndCommit(20)
    // 100% adoption so the preference weight sits ABOVE the floor and the
    // delta adjustment is observable (not hidden behind the clamp).
    database.beginTransaction()
    approveAllActions()
    await database.commit()
    // 20 overrides, PM priority 2 vs H6 8 → signed delta -6, |delta| 6.
    await recordDecisions(recIds, 'OVERRIDE', 20, 2)

    await compile()
    const cal = await calibrateHigh80()

    const signals = await profileRepository.getSignals(WS, PROJECT)
    const ov = signals.find((s) => s.type === 'OVERRIDE')
    const delta = signals.find((s) => s.type === 'PRIORITY_OVERRIDE_DELTA')
    expect(ov).toBeDefined()
    expect(ov!.value).toBe(1.0) // 20/20 overrides
    expect(delta).toBeDefined()
    expect(delta!.value).toBe(6) // mean |8 - 2|
    expect(delta!.meanSignedOverrideDelta).toBe(-6) // mean (2 - 8)
    expect(delta!.sourceTelemetryIds).toHaveLength(20)

    // The signal must be RECEIVED by calibration: the signed delta pushes the
    // multiplier DOWN from the 1.15 adoption weight, bounded and dampened.
    const expectedBase = MULTIPLIER_CEIL // 100% adoption → 1.15
    expect(cal.preferenceMultiplier).toBeLessThan(expectedBase)
    expect(cal.preferenceMultiplier).toBeGreaterThanOrEqual(MULTIPLIER_FLOOR)
    // -6 points / 5 = -1.0 normalized → -0.1 * (20/30) = -0.0667 adjustment.
    expect(expectedBase - cal.preferenceMultiplier).toBeCloseTo(
      H7_OVERRIDE_DELTA_ADJUSTMENT_MAX * (20 / 30),
      2
    )
    expect(cal.explanation).toMatch(/mean override delta 6\.00 \(signed -6\.00\)/)
  })

  it('C2 — small consistent corrections produce a SMALLER adjustment than large ones', async () => {
    // Small-delta world: 20 overrides of 1 point (PM priority 7 vs H6 8).
    const recIdsSmall = await seedAndCommit(20)
    database.beginTransaction()
    approveAllActions()
    await database.commit()
    await recordDecisions(recIdsSmall, 'OVERRIDE', 20, 7)
    await compile()
    const small = await calibrateHigh80()
    const deltaSmall = (await profileRepository.getSignals(WS, PROJECT)).find(
      (s) => s.type === 'PRIORITY_OVERRIDE_DELTA'
    )
    expect(deltaSmall!.value).toBe(1)
    expect(deltaSmall!.meanSignedOverrideDelta).toBe(-1)

    // Reset and build the large-delta world (PM priority 2 vs H6 8).
    await resetWorld()
    const recIdsLarge = await seedAndCommit(20)
    database.beginTransaction()
    approveAllActions()
    await database.commit()
    await recordDecisions(recIdsLarge, 'OVERRIDE', 20, 2)
    await compile()
    const large = await calibrateHigh80()
    // Adjustment magnitude measured from the SAME base weight (1.15): a
    // 1-point correction moves ~0.013; a 6-point correction moves ~0.067.
    const smallAdj = MULTIPLIER_CEIL - small.preferenceMultiplier
    const largeAdj = MULTIPLIER_CEIL - large.preferenceMultiplier
    expect(largeAdj).toBeGreaterThan(smallAdj)
    expect(smallAdj).toBeLessThan(H7_OVERRIDE_DELTA_ADJUSTMENT_MAX + 1e-9)
    expect(largeAdj).toBeLessThan(H7_OVERRIDE_DELTA_ADJUSTMENT_MAX + 1e-9)
    // Small samples cannot overreact: both are dampened by 20/30 confidence.
    expect(smallAdj).toBeCloseTo(H7_OVERRIDE_DELTA_ADJUSTMENT_MAX * (1 / 5) * (20 / 30), 2)
    expect(largeAdj).toBeCloseTo(H7_OVERRIDE_DELTA_ADJUSTMENT_MAX * (20 / 30), 2)
  })

  // ---------- Scenario D: mixed behavior ----------

  it('D — mixed behavior (40% ACCEPT / 30% REJECT / 20% DEFER / 10% OVERRIDE) is deterministic', async () => {
    const recIds = await seedAndCommit(20)
    // 20 decisions: 8 ACCEPT, 6 REJECT, 4 DEFER, 2 OVERRIDE (priority 5 → delta 3)
    await recordDecisions(recIds, 'ACCEPT', 8)
    await recordDecisions(recIds, 'REJECT', 6)
    await recordDecisions(recIds, 'DEFER', 4)
    await recordDecisions(recIds, 'OVERRIDE', 2, 5)

    await compile()
    const signals = await profileRepository.getSignals(WS, PROJECT)
    const acc = signals.find((s) => s.type === 'ACCEPTANCE')
    const rej = signals.find((s) => s.type === 'REJECTION')
    const def = signals.find((s) => s.type === 'DEFER')
    // 2 OVERRIDE records are below the signal-generation threshold (3) —
    // no OVERRIDE signal exists for this population.
    const ov = signals.find((s) => s.type === 'OVERRIDE')
    expect(acc!.value).toBeCloseTo(0.4, 5)
    expect(rej!.value).toBeCloseTo(0.3, 5)
    expect(def!.value).toBeCloseTo(0.2, 5)
    expect(ov).toBeUndefined()

    const cal1 = await calibrateHigh80()
    const cal2 = await calibrateHigh80()
    // Deterministic: same state → same calibration, every time.
    expect(cal1.calibratedScore).toBe(cal2.calibratedScore)
    expect(cal1.preferenceMultiplier).toBe(cal2.preferenceMultiplier)

    // Valence 0.4 - 0.3 = +0.1 → small positive adjustment, always bounded.
    expect(cal1.preferenceMultiplier).toBeGreaterThan(MULTIPLIER_FLOOR)
    expect(cal1.preferenceMultiplier).toBeLessThanOrEqual(MULTIPLIER_CEIL)
    expect(cal1.explanation).toMatch(/ACCEPT 40% \/ REJECT 30%/)
    // The 4-record DEFER evidence is insufficient and must be excluded from
    // the adjustment — flagged, never silently used.
    expect(cal1.explanation).toMatch(/DEFER evidence insufficient/)
  })

  // ---------- Scenario E: insufficient evidence ----------

  it('E — 1–4 observations produce NO meaningful calibration shift', async () => {
    for (const n of [1, 2, 3, 4]) {
      const recIds = await seedAndCommit(20)
      // n ACCEPT decisions among 20 recs (all actions stay proposed).
      await recordDecisions(recIds, 'ACCEPT', n)
      await compile()

      const cal = await calibrateHigh80()
      const signals = await profileRepository.getSignals(WS, PROJECT)
      const acc = signals.find((s) => s.type === 'ACCEPTANCE')

      if (n < 3) {
        // Below MIN_OBSERVATIONS_FOR_SIGNAL: no telemetry signal at all.
        expect(acc, `n=${n}`).toBeUndefined()
      } else {
        // n = 3..4: signal exists but MUST be insufficient_evidence and be
        // EXCLUDED from the calibration formula (no H7-driven shift).
        expect(acc!.evidenceState).toBe('insufficient_evidence')
        expect(cal.explanation).toMatch(/evidence insufficient/)
      }
      // No meaningful calibration shift: the multiplier equals the
      // no-telemetry baseline (adoption floor weight 0.85) — the H7
      // evidence never moved it.
      expect(cal.preferenceMultiplier, `n=${n}`).toBeCloseTo(MULTIPLIER_FLOOR, 2)
      expect(cal.calibratedScore, `n=${n}`).toBe(SAFETY_FLOOR_HIGH)

      // Clean slate for the next n.
      await resetWorld()
    }
  })

  // ---------- Scenario F: convergence boundary ----------

  it('F — boundary N = 4 / 5 / 19 / 20 gates the H7 evidence exactly', async () => {
    const cases: Array<[number, 'insufficient_evidence' | 'observed']> = [
      [4, 'insufficient_evidence'],
      [5, 'observed'],
      [19, 'observed'],
      [20, 'observed'],
    ]
    for (const [n, expectedState] of cases) {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, 'ACCEPT', n)
      await compile()

      const signals = await profileRepository.getSignals(WS, PROJECT)
      const acc = signals.find((s) => s.type === 'ACCEPTANCE')
      expect(acc, `N=${n}`).toBeDefined()
      expect(acc!.evidenceState, `N=${n}`).toBe(expectedState)
      expect(acc!.observationCount, `N=${n}`).toBe(n)
      // Confidence is the documented dampener n/(n+10) — not a statistical
      // significance claim.
      expect(acc!.confidence, `N=${n}`).toBeCloseTo(n / (n + 10), 5)

      await resetWorld()
    }
  })

  // ---------- Scenario G: contradictory signals ----------

  it('G — high acceptance + high override rate + large delta is NOT blind preference', async () => {
    const recIds = await seedAndCommit(20)
    database.beginTransaction()
    approveAllActions()
    await database.commit()
    // 10 ACCEPT (50%), 10 OVERRIDE (50%) with priority 2 → delta 6.
    await recordDecisions(recIds, 'ACCEPT', 10)
    await recordDecisions(recIds, 'OVERRIDE', 10, 2)

    await compile()
    const cal = await calibrateHigh80()

    const signals = await profileRepository.getSignals(WS, PROJECT)
    const acc = signals.find((s) => s.type === 'ACCEPTANCE')
    const ov = signals.find((s) => s.type === 'OVERRIDE')
    expect(acc!.value).toBe(0.5)
    expect(ov!.value).toBe(0.5)

    // A naive "simple preference" reading of 50% acceptance would push the
    // multiplier toward the 1.15 ceiling. The ambiguity dampening (override
    // rate 50% + delta 6) plus the signed-delta pull keep it BELOW the
    // ceiling — the system does not blindly interpret this as preference.
    expect(cal.preferenceMultiplier).toBeLessThan(MULTIPLIER_CEIL)
    expect(cal.explanation).toMatch(/treated as ambiguity/)
    // Output stays bounded and explainable.
    expect(cal.preferenceMultiplier).toBeGreaterThanOrEqual(MULTIPLIER_FLOOR)
    expect(cal.preferenceMultiplier).toBeLessThanOrEqual(MULTIPLIER_CEIL)
    expect(cal.explanation).toMatch(/calibration version: h6-v2/)
    // Deterministic.
    const cal2 = await calibrateHigh80()
    expect(cal.calibratedScore).toBe(cal2.calibratedScore)
  })

  // ---------- Safety floors (§9) ----------

  it('safety floors hold under 100% rejection / 100% defer / 100% override', async () => {
    const worlds: Array<[string, PMDecisionKind, number | undefined]> = [
      ['100% rejection', 'REJECT', undefined],
      ['100% defer', 'DEFER', undefined],
      ['100% override with extreme delta', 'OVERRIDE', 0.5], // |8 - 0.5| = 7.5
    ]
    for (const [label, kind, priority] of worlds) {
      const recIds = await seedAndCommit(20)
      await recordDecisions(recIds, kind, 20, priority)
      await compile()

      const profile = await profileRepository.getProfile(WS, PROJECT)
      const signals = await profileRepository.getSignals(WS, PROJECT)
      const calCritical = calibrator.calibrate(richRec('critical', 9.5), profile, signals)
      const calHigh = calibrator.calibrate(richRec('high', 8.0), profile, signals)
      expect(calCritical.calibratedScore, label).toBeGreaterThanOrEqual(SAFETY_FLOOR_CRITICAL)
      expect(calHigh.calibratedScore, label).toBeGreaterThanOrEqual(SAFETY_FLOOR_HIGH)

      await resetWorld()
    }
  })

  it('safety floors hold with zero outcomes, failed outcomes, and mixed signals', async () => {
    const recIds = await seedAndCommit(20)
    await recordDecisions(recIds, 'REJECT', 10)
    await recordDecisions(recIds, 'DEFER', 5)
    await recordDecisions(recIds, 'OVERRIDE', 5, 3)

    // Zero outcomes: no outcome rows at all.
    await compile()
    let profile = await profileRepository.getProfile(WS, PROJECT)
    let signals = await profileRepository.getSignals(WS, PROJECT)
    expect(
      profile!.categoryCoefficients.find((c) => c.category === 'TESTING')!.outcomeVerifiedRate
    ).toBe(0)
    let cal = calibrator.calibrate(richRec('critical', 9.5), profile, signals)
    expect(cal.calibratedScore).toBeGreaterThanOrEqual(SAFETY_FLOOR_CRITICAL)

    // Failed outcomes only.
    database.beginTransaction()
    for (let i = 0; i < 5; i++) {
      database.getActiveState().outcomes.push({
        id: `out-fail-${i}`,
        workspaceId: WS,
        projectId: PROJECT,
        recommendationId: recIds[i],
        status: 'FAILED',
        actionId: null,
        executionId: null,
        verifiedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never)
    }
    await database.commit()
    await compile()
    profile = await profileRepository.getProfile(WS, PROJECT)
    signals = await profileRepository.getSignals(WS, PROJECT)
    cal = calibrator.calibrate(richRec('critical', 9.5), profile, signals)
    expect(cal.calibratedScore).toBeGreaterThanOrEqual(SAFETY_FLOOR_CRITICAL)
    // The outcome reliability multiplier can never leave [0.9, 1.1].
    expect(cal.outcomeReliabilityMultiplier).toBeGreaterThanOrEqual(0.9)
    expect(cal.outcomeReliabilityMultiplier).toBeLessThanOrEqual(1.1)
  })

  // ---------- Acceptance population (§3) ----------

  it('decisionAcceptanceRate = ACCEPT telemetry / total decision telemetry ONLY', async () => {
    const recIds = await seedAndCommit(10)
    // 4 ACCEPT, 3 REJECT, 2 DEFER, 1 OVERRIDE — 10 decisions total.
    await recordDecisions(recIds, 'ACCEPT', 4)
    await recordDecisions(recIds, 'REJECT', 3)
    await recordDecisions(recIds, 'DEFER', 2)
    await recordDecisions(recIds, 'OVERRIDE', 1, 6)

    const metrics = await validationService.evaluatePMValue(WS, PROJECT)
    expect(metrics.observationCount).toBe(10)
    expect(metrics.decisionAcceptanceRate.observationCount).toBe(10)
    expect(metrics.decisionAcceptanceRate.value).toBe(40)
    expect(metrics.decisionRejectionRate.value).toBe(30)
    expect(metrics.decisionDeferRate.value).toBe(20)
    expect(metrics.decisionOverrideRate.value).toBe(10)
    expect(metrics.meanPriorityOverrideDelta.value).toBeCloseTo(2, 5) // |8-6|
    // Execution metrics stay on the action population (all proposed → no data).
    expect(metrics.executionSuccessRate.value).toBeNull()
    // Outcome metrics stay on the outcome population (none → unavailable).
    expect(metrics.outcomeSuccessRate.value).toBeNull()
  })

  // ---------- Provenance (§6) ----------

  it('every H7 signal reconstructs its rate from persisted telemetry alone (denominator + numerator provenance)', async () => {
    const recIds = await seedAndCommit(20)
    // 15 decisions total: 10 REJECT + 5 OVERRIDE (priority 4).
    await recordDecisions(recIds, 'REJECT', 10)
    await recordDecisions(recIds, 'OVERRIDE', 5, 4)

    await compile()
    const signals = await profileRepository.getSignals(WS, PROJECT)
    const telemetry = await productRepository.getPMDecisionTelemetryByProject(PROJECT, WS)
    const allIds = telemetry.map((t) => t.id)

    const RATE_SIGNALS = new Set(['ACCEPTANCE', 'REJECTION', 'DEFER', 'OVERRIDE'])
    for (const sig of decisionSignals(signals)) {
      expect(sig.sourceTelemetryIds, sig.type).toBeDefined()
      expect(sig.calibrationVersion).toBe(CALIBRATION_VERSION)
      // 1) Every denominator id in sourceTelemetryIds is a REAL persisted
      //    telemetry record.
      for (const tid of sig.sourceTelemetryIds!) {
        expect(
          telemetry.find((t) => t.id === tid),
          `${sig.type} -> ${tid}`
        ).toBeDefined()
      }
      // 2) The signal is reconstructible: observationCount is the full
      //    denominator population.
      expect(sig.sourceTelemetryIds!.length, sig.type).toBe(sig.observationCount)
      expect(sig.sourceRecommendationIds.length).toBe(sig.sourceTelemetryIds!.length)
      expect(sig.numeratorTelemetryIds, sig.type).toBeDefined()
      // 3) A RATE signal's value is exactly |numerator| / |denominator|.
      //    (PRIORITY_OVERRIDE_DELTA's value is a mean magnitude, not a rate;
      //    it still carries full denominator+numerator provenance.)
      if (RATE_SIGNALS.has(sig.type)) {
        expect(sig.value, sig.type).toBeCloseTo(
          sig.numeratorTelemetryIds!.length / sig.sourceTelemetryIds!.length,
          5
        )
      }
    }

    // REJECTION: denominator = the complete 15-record population; numerator
    // = exactly the 10 REJECT records. value = 10/15.
    const rejection = signals.find((s) => s.type === 'REJECTION')
    expect(rejection!.sourceTelemetryIds).toHaveLength(15)
    expect(rejection!.sourceTelemetryIds!.sort()).toEqual([...allIds].sort())
    expect(rejection!.numeratorTelemetryIds).toHaveLength(10)
    expect(rejection!.observationCount).toBe(15)
    expect(rejection!.value).toBeCloseTo(10 / 15, 5)
    // Every numerator record is a real REJECT record.
    const telemetryById = new Map(telemetry.map((t) => [t.id, t]))
    for (const tid of rejection!.numeratorTelemetryIds!) {
      expect(telemetryById.get(tid)!.decision).toBe('REJECT')
    }
    // OVERRIDE: denominator = full 15-record population; numerator = 5.
    const override = signals.find((s) => s.type === 'OVERRIDE')
    expect(override!.sourceTelemetryIds).toHaveLength(15)
    expect(override!.numeratorTelemetryIds).toHaveLength(5)
    expect(override!.value).toBeCloseTo(5 / 15, 5)
    // The delta signal is computed over ONLY the 5 override-with-delta
    // records (its own population is both numerator and denominator).
    const delta = signals.find((s) => s.type === 'PRIORITY_OVERRIDE_DELTA')
    expect(delta!.sourceTelemetryIds).toHaveLength(5)
    expect(delta!.numeratorTelemetryIds).toHaveLength(5)
    expect(delta!.meanSignedOverrideDelta).toBeCloseTo(-4, 5) // mean(4 - 8)
  })

  // ---------- Multi-tenant / multi-project isolation (§11) ----------

  it('workspace A/project A telemetry cannot influence workspace A/project B calibration', async () => {
    const PROJ_B = 'proj-effect-b'
    const recIdsA = await seedAndCommit(20, WS, PROJECT)
    await recordDecisions(recIdsA, 'ACCEPT', 20) // WS_A/PROJ_A: 100% acceptance

    // WS_A/PROJ_B: same workspace, different project — 20 REJECT decisions.
    const recIdsB = await seedAndCommit(20, WS, PROJ_B)
    for (let i = 0; i < 20; i++) {
      const base = new Date(2026, 7, 9, 10, 0, i)
      await telemetryService.recordDecision({
        workspaceId: WS,
        projectId: PROJ_B,
        recommendationId: recIdsB[i % recIdsB.length],
        originalH3Score: 8.0,
        calibratedH6Score: 8.0,
        decision: 'REJECT',
        decisionStartedAt: base,
        decisionCompletedAt: new Date(base.getTime() + 60000),
        recommendationPresentedAt: new Date(base.getTime() - 60000),
      })
    }

    await compiler.compileProfile(WS, PROJECT)
    await compiler.compileProfile(WS, PROJ_B)

    const signalsA = await profileRepository.getSignals(WS, PROJECT)
    const signalsB = await profileRepository.getSignals(WS, PROJ_B)
    expect(signalsA.find((s) => s.type === 'ACCEPTANCE')!.value).toBe(1.0)
    expect(signalsB.find((s) => s.type === 'REJECTION')!.value).toBe(1.0)
    // Project A must have NO rejection evidence (0 rejects → no REJECTION
    // signal); project B's ACCEPTANCE rate is 0% — never A's 100%.
    expect(signalsA.find((s) => s.type === 'REJECTION')).toBeUndefined()
    // Project B's ACCEPTANCE rate is 0% — the rate is observed (denominator
    // = its 20-record population) but its numerator is empty. This is an
    // OBSERVED zero rate, not absence of evidence.
    const accB = signalsB.find((s) => s.type === 'ACCEPTANCE')!
    expect(accB.value).toBe(0)
    expect(accB.sourceTelemetryIds).toHaveLength(20)
    expect(accB.numeratorTelemetryIds).toHaveLength(0)

    // Calibration responds only to the project's own telemetry.
    const profileA = await profileRepository.getProfile(WS, PROJECT)
    const profileB = await profileRepository.getProfile(WS, PROJ_B)
    const calA = calibrator.calibrate(richRec('high', 8.0), profileA, signalsA)
    const calB = calibrator.calibrate(richRec('high', 8.0), profileB, signalsB)
    expect(calA.preferenceMultiplier).toBeGreaterThan(calB.preferenceMultiplier)

    // Validation metrics are project-scoped too.
    const metricsA = await validationService.evaluatePMValue(WS, PROJECT)
    const metricsB = await validationService.evaluatePMValue(WS, PROJ_B)
    expect(metricsA.decisionAcceptanceRate.value).toBe(100)
    expect(metricsB.decisionAcceptanceRate.value).toBe(0)
    expect(metricsA.decisionRejectionRate.value).toBe(0)
    expect(metricsB.decisionRejectionRate.value).toBe(100)
  })

  it('same recommendationId in different workspaces cannot cross-contaminate telemetry', async () => {
    const WS_B = createWorkspaceId('ws-effect-c')
    const sharedRecId = 'rec-same-id'
    database.beginTransaction()
    seedRecommendations(1, WS, PROJECT)
    seedRecommendations(1, WS_B, 'proj-b')
    await database.commit()

    const now = new Date()
    await telemetryService.recordDecision({
      workspaceId: WS,
      projectId: PROJECT,
      recommendationId: sharedRecId,
      originalH3Score: 8.0,
      calibratedH6Score: 8.0,
      decision: 'ACCEPT',
      decisionStartedAt: new Date(now.getTime() - 60000),
      decisionCompletedAt: now,
      recommendationPresentedAt: new Date(now.getTime() - 120000),
    })
    await telemetryService.recordDecision({
      workspaceId: WS_B,
      projectId: 'proj-b',
      recommendationId: sharedRecId,
      originalH3Score: 8.0,
      calibratedH6Score: 8.0,
      decision: 'REJECT',
      decisionStartedAt: new Date(now.getTime() - 60000),
      decisionCompletedAt: now,
      recommendationPresentedAt: new Date(now.getTime() - 120000),
    })

    const teleA = await productRepository.getPMDecisionTelemetryByProject(PROJECT, WS)
    const teleB = await productRepository.getPMDecisionTelemetryByProject('proj-b', WS_B)
    expect(teleA).toHaveLength(1)
    expect(teleA[0].decision).toBe('ACCEPT')
    expect(teleB).toHaveLength(1)
    expect(teleB[0].decision).toBe('REJECT')
  })

  // ---------- Domain ordering validation (§5) ----------

  it('domain validation rejects presentation-after-decision-start', async () => {
    database.beginTransaction()
    seedRecommendations(1)
    await database.commit()
    const recId = (await productRepository.getRecommendationsByProject(PROJECT, WS))[0].id

    await expect(
      telemetryService.recordDecision({
        workspaceId: WS,
        projectId: PROJECT,
        recommendationId: recId,
        originalH3Score: 8.0,
        calibratedH6Score: 8.0,
        decision: 'ACCEPT',
        decisionStartedAt: new Date('2026-08-09T10:00:00Z'),
        decisionCompletedAt: new Date('2026-08-09T10:01:00Z'),
        recommendationPresentedAt: new Date('2026-08-09T10:00:30Z'), // AFTER start
      })
    ).rejects.toThrow(/must not follow decisionStartedAt/)

    // Nothing entered the store.
    const tele = await productRepository.getPMDecisionTelemetryByProject(PROJECT, WS)
    expect(tele).toHaveLength(0)
  })

  it('DECISION_LATENCY stays observational — it never modifies calibration', async () => {
    const recIds = await seedAndCommit(20)
    await recordDecisions(recIds, 'ACCEPT', 20)
    await compile()

    const signals = await profileRepository.getSignals(WS, PROJECT)
    const latency = signals.find((s) => s.type === 'DECISION_LATENCY')
    expect(latency).toBeDefined()
    expect(latency!.value).toBe(60)
    expect(latency!.sourceTelemetryIds).toHaveLength(20)

    const profile = await profileRepository.getProfile(WS, PROJECT)
    const cal = calibrator.calibrate(richRec('high', 8.0), profile, signals)
    // The latency signal is in appliedSignals (auditable) but the formula
    // must not contain it: with 20 ACCEPT and 0 ambiguity the adjustment is
    // exactly valence * 0.3 * (20/30) * 1.
    const expectedAdjustment = H7_DECISION_ADJUSTMENT_MAX * (20 / 30)
    expect(cal.appliedSignals.map((s) => s.type)).toContain('DECISION_LATENCY')
    expect(cal.explanation).toMatch(/observational evidence only/)
    expect(cal.preferenceMultiplier).toBeCloseTo(0.85 + expectedAdjustment, 2)
  })
})
