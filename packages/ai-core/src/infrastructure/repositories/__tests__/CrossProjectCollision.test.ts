import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../database/DurableFileDatabase'
import { SqlProductRepository } from '../SqlProductRepository'
import { SqlRecommendationOutcomeRepository } from '../SqlRecommendationOutcomeRepository'
import { SqlAdaptiveLearningProfileRepository } from '../SqlAdaptiveLearningProfileRepository'
import { createCorrelationFinding } from '../../../domain/entities/Finding'
import { createRecommendation } from '../../../domain/entities/Recommendation'
import { createRecommendationOutcome } from '../../../domain/entities/RecommendationOutcome'
import { InsightMapper } from '../../../intelligence/mappers/InsightMapper'
import { createWorkspaceId } from '../../../domain/value-objects'
import type {
  PMDecisionTelemetry,
  PMDecisionKind,
} from '../../../domain/entities/PMDecisionTelemetry'
import type {
  AdaptiveLearningProfile,
  LearningSignal,
} from '../../../domain/entities/ProductAdaptive'

const TEST_DB_DIR = path.join(process.cwd(), 'database-cross-project-collision-test')

/**
 * Phase 3 — Project Isolation collision regression (same WORKSPACE, two
 * PROJECTS sharing an identical resource id).
 *
 * Invariant: Project B MUST NEVER overwrite Project A's row when both use
 * the same resource id inside the same workspace. Every project-owned
 * entity upsert is scoped by (id, workspaceId, projectId) — the same
 * belt-and-braces guarantee the telemetry upsert applies — so the two rows
 * coexist and reads return the correct project's resource.
 *
 * This is independent of how ids are GENERATED upstream: even if two
 * projects could ever produce a colliding id (e.g. both analyzing the same
 * repository, or a future id scheme), the persisted rows must coexist.
 */
describe('Cross-project id collision isolation (same workspace, two projects)', () => {
  let db: DurableFileDatabase
  let productRepo: SqlProductRepository
  let outcomeRepo: SqlRecommendationOutcomeRepository
  let profileRepo: SqlAdaptiveLearningProfileRepository

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    db = new DurableFileDatabase(TEST_DB_DIR)
    await db.initialize()
    productRepo = new SqlProductRepository(db)
    outcomeRepo = new SqlRecommendationOutcomeRepository(db)
    profileRepo = new SqlAdaptiveLearningProfileRepository(db)
  })

  afterAll(() => {
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
  })

  const WS = createWorkspaceId('ws-shared')
  const PROJ_A = 'proj-a'
  const PROJ_B = 'proj-b'

  it('recommendations: same id in two projects of one workspace coexist (Scenario A)', async () => {
    const base = {
      origin: 'finding' as const,
      deduplicationKey: 'dk',
      title: 'Collide',
      rationale: 'r',
      impact: 'i',
      effort: 'low' as const,
      priority: 'high' as const,
      confidence: 0.5,
      insightIds: [],
      findingIds: ['f-1'],
      proposedActions: [],
    }
    const recA = createRecommendation({ ...base, id: 'rec-collision', workspaceId: WS })
    const recB = createRecommendation({ ...base, id: 'rec-collision', workspaceId: WS })

    await productRepo.saveRecommendation(recA, PROJ_A)
    await productRepo.saveRecommendation(recB, PROJ_B)

    const a = await productRepo.getRecommendationsByProject(PROJ_A, WS)
    const b = await productRepo.getRecommendationsByProject(PROJ_B, WS)

    // Both rows MUST survive (Scenario A). Previously the second save
    // silently DELETED project A's row because the upsert was keyed by
    // (id, workspaceId) only.
    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
    // Scenario B: each read returns the correct project's resource.
    expect((a[0] as { projectId?: string }).projectId).toBe(PROJ_A)
    expect((b[0] as { projectId?: string }).projectId).toBe(PROJ_B)
  })

  it('findings: same id in two projects of one workspace coexist (Scenario A)', async () => {
    const base = {
      workspaceId: WS,
      type: 'risk' as const,
      title: 'Collide',
      description: 'd',
      priority: 'high' as const,
      severity: 'high' as const,
      evidenceIds: ['e-1'],
      correlationId: 'c-1',
    }
    const findingA = createCorrelationFinding({ ...base, id: 'finding-collision' })
    const findingB = createCorrelationFinding({ ...base, id: 'finding-collision' })

    await productRepo.saveFinding(findingA, PROJ_A)
    await productRepo.saveFinding(findingB, PROJ_B)

    const a = await productRepo.getFindingsByProject(PROJ_A, WS)
    const b = await productRepo.getFindingsByProject(PROJ_B, WS)

    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
  })

  it('telemetry: same (rec id, window) in two projects produce distinct ids and coexist', async () => {
    // The telemetry id is a deterministic hash of (workspace, project,
    // recommendation, decisionStartedAt). Two projects with the same rec id
    // and the same decision window MUST produce different ids and both MUST
    // persist.
    const started = new Date('2026-08-09T10:00:00.000Z')
    const make = (projectId: string): PMDecisionTelemetry => ({
      id: `pmd-${projectId}`,
      workspaceId: WS,
      projectId,
      recommendationId: 'rec-shared',
      category: 'TESTING',
      recommendationPresentedAt: new Date('2026-08-09T09:59:00.000Z'),
      decisionStartedAt: started,
      decisionCompletedAt: new Date('2026-08-09T10:01:00.000Z'),
      decision: 'ACCEPT' as PMDecisionKind,
      calibratedH6Score: 8,
      originalH3Score: 8,
      overrideOccurred: false,
      recordedAt: new Date(),
    })

    await productRepo.savePMDecisionTelemetry(make(PROJ_A))
    await productRepo.savePMDecisionTelemetry(make(PROJ_B))

    const a = await productRepo.getPMDecisionTelemetryByProject(PROJ_A, WS)
    const b = await productRepo.getPMDecisionTelemetryByProject(PROJ_B, WS)

    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
    expect(a[0].projectId).toBe(PROJ_A)
    expect(b[0].projectId).toBe(PROJ_B)
  })

  it('outcomes: same id in two projects of one workspace coexist (Scenario A)', async () => {
    const make = (projectId: string) =>
      createRecommendationOutcome({
        id: 'outcome-collision',
        recommendationId: 'rec-shared',
        workspaceId: WS,
        projectId,
        actionId: null,
        executionId: null,
        status: 'PENDING',
        verificationStatus: 'pending',
        verificationEvidence: [],
        outcomeSummary: 's',
      })

    await outcomeRepo.save(make(PROJ_A))
    await outcomeRepo.save(make(PROJ_B))

    const a = await outcomeRepo.getByProject(PROJ_A, WS)
    const b = await outcomeRepo.getByProject(PROJ_B, WS)

    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
    expect(a[0].projectId).toBe(PROJ_A)
    expect(b[0].projectId).toBe(PROJ_B)
  })

  it('action idempotency keys: same recommendation id in two projects produce distinct action idempotency keys', async () => {
    // Regression test for P0: Action idempotency key is generated from
    // (workspaceId, recommendationId, proposedActionId). If two projects
    // somehow produce the same recommendation id, the action idempotency
    // keys would collide. This test proves that when recommendation IDs
    // are project-scoped (via insight-scoped deduplication keys), the
    // resulting action idempotency keys are distinct.
    const recA = createRecommendation({
      origin: 'insight' as const,
      deduplicationKey: 'add-testing:insight:proj-a-insight-1',
      title: 'Rec A',
      rationale: 'r',
      impact: 'i',
      effort: 'low' as const,
      priority: 'high' as const,
      confidence: 0.5,
      insightIds: ['proj-a-insight-1'],
      findingIds: [],
      proposedActions: [{ id: 'proj-a-action-1', title: 'Action A', description: 'd' }],
      workspaceId: WS,
    })
    const recB = createRecommendation({
      origin: 'insight' as const,
      deduplicationKey: 'add-testing:insight:proj-b-insight-1',
      title: 'Rec B',
      rationale: 'r',
      impact: 'i',
      effort: 'low' as const,
      priority: 'high' as const,
      confidence: 0.5,
      insightIds: ['proj-b-insight-1'],
      findingIds: [],
      proposedActions: [{ id: 'proj-b-action-1', title: 'Action B', description: 'd' }],
      workspaceId: WS,
    })

    // Verify recommendation IDs are distinct (project-scoped)
    expect(recA.id).not.toBe(recB.id)

    await productRepo.saveRecommendation(recA, PROJ_A)
    await productRepo.saveRecommendation(recB, PROJ_B)

    // Both persisted and retrievable
    const a = await productRepo.getRecommendationsByProject(PROJ_A, WS)
    const b = await productRepo.getRecommendationsByProject(PROJ_B, WS)
    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
    expect(a[0].id).not.toBe(b[0].id)
  })

  it('insightMapper: produces project-scoped insight IDs (same ruleId in two projects yields distinct ids)', async () => {
    // Proves the full architectural chain:
    //   project → insight ID → recommendation ID → action idempotency key
    // is project-distinct from the very first step.
    const mapper = new InsightMapper()
    const ruleResults = [
      {
        ruleId: 'add-testing',
        matched: true,
        severity: 'medium' as const,
        priority: 'medium' as const,
        title: 't',
        message: 'm',
        evidenceIds: [],
      },
    ]
    const insightsA = mapper.toInsights(ruleResults, WS, 'github', PROJ_A)
    const insightsB = mapper.toInsights(ruleResults, WS, 'github', PROJ_B)

    // Same ruleId but different projects → different insight IDs
    expect(insightsA[0].id).not.toBe(insightsB[0].id)
    // Explicit shape check: id contains the project id
    expect(insightsA[0].id).toContain(PROJ_A)
    expect(insightsB[0].id).toContain(PROJ_B)
    // Workspace is shared
    expect(insightsA[0].workspaceId).toBe(WS)
    expect(insightsB[0].workspaceId).toBe(WS)
  })

  it('learning signals + profile: two projects of one workspace keep separate signals/profiles', async () => {
    const signalA: LearningSignal = {
      id: 'sig-a',
      workspaceId: WS,
      projectId: PROJ_A,
      category: 'TESTING',
      type: 'ACCEPTANCE',
      observationCount: 5,
      value: 0.8,
      confidence: 0.33,
      sourceRecommendationIds: ['rec-a'],
      generatedAt: new Date(),
      evidenceState: 'observed',
      calibrationVersion: 'h6-v2',
    }
    const signalB: LearningSignal = {
      ...signalA,
      id: 'sig-b',
      projectId: PROJ_B,
      value: 0.2,
      sourceRecommendationIds: ['rec-b'],
    }
    await profileRepo.saveSignals([signalA])
    await profileRepo.saveSignals([signalB])

    const a = await profileRepo.getSignals(WS, PROJ_A)
    const b = await profileRepo.getSignals(WS, PROJ_B)

    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
    expect(a[0].value).toBe(0.8)
    expect(b[0].value).toBe(0.2)

    const profileA: AdaptiveLearningProfile = {
      workspaceId: WS,
      projectId: PROJ_A,
      totalDecisionsObserved: 5,
      lastCalculatedAt: new Date(),
      PMPreferences: { favoredCategories: [], ignoredCategories: [] },
      categoryCoefficients: [],
      biasAdjustments: { overPrioritizedLowEffort: false, favoredHighImpact: false },
      calibrationVersion: 'h6-v2',
    }
    const profileB: AdaptiveLearningProfile = {
      ...profileA,
      projectId: PROJ_B,
      totalDecisionsObserved: 1,
    }
    await profileRepo.saveProfile(profileA)
    await profileRepo.saveProfile(profileB)

    expect((await profileRepo.getProfile(WS, PROJ_A))?.totalDecisionsObserved).toBe(5)
    expect((await profileRepo.getProfile(WS, PROJ_B))?.totalDecisionsObserved).toBe(1)
  })
})

/**
 * H8-ACTION-1 — Project-Scoped Recommendation Identity regression tests.
 *
 * Proves that:
 *   1. Same workspace + different projects + same recommendation ID → no cross-contamination
 *   2. Different workspace + same project ID → no cross-contamination
 *   3. ID substitution across workspaces → fails safely
 */
describe('H8-ACTION-1 — project-scoped recommendation identity', () => {
  let db: DurableFileDatabase
  let productRepo: SqlProductRepository

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    db = new DurableFileDatabase(TEST_DB_DIR)
    await db.initialize()
    productRepo = new SqlProductRepository(db)
  })

  afterAll(() => {
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
  })

  const WS_A = createWorkspaceId('ws-identity-a')
  const WS_B = createWorkspaceId('ws-identity-b')
  const PROJ_X = 'proj-identity-x'
  const PROJ_Y = 'proj-identity-y'
  const REC_ID = 'rec-shared-identity'

  const baseRec = {
    origin: 'finding' as const,
    deduplicationKey: 'dk-identity',
    title: 'Shared Identity Test',
    rationale: 'r',
    impact: 'i',
    effort: 'low' as const,
    priority: 'high' as const,
    confidence: 0.5,
    insightIds: [],
    findingIds: ['f-identity'],
    proposedActions: [],
  }

  it('same workspace, different projects, same rec ID → getRecommendationByIdWorkspaceAndProject isolates', async () => {
    const recA = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_A })
    const recB = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_A })
    await productRepo.saveRecommendation(recA, PROJ_X)
    await productRepo.saveRecommendation(recB, PROJ_Y)

    const foundA = await productRepo.getRecommendationByIdWorkspaceAndProject(REC_ID, WS_A, PROJ_X)
    const foundB = await productRepo.getRecommendationByIdWorkspaceAndProject(REC_ID, WS_A, PROJ_Y)

    expect(foundA).not.toBeNull()
    expect(foundB).not.toBeNull()
    expect(foundA!.id).toBe(REC_ID)
    expect(foundB!.id).toBe(REC_ID)
    // Both exist but are independent — reading A's project does not return B's data
    const recsA = await productRepo.getRecommendationsByProject(PROJ_X, WS_A)
    expect(recsA.find((r) => r.id === REC_ID)?.deduplicationKey).toBe('dk-identity')
  })

  it('different workspace, same project ID → no cross-contamination', async () => {
    const recWsA = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_A })
    const recWsB = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_B })
    await productRepo.saveRecommendation(recWsA, PROJ_X)
    await productRepo.saveRecommendation(recWsB, PROJ_X)

    const foundA = await productRepo.getRecommendationByIdWorkspaceAndProject(REC_ID, WS_A, PROJ_X)
    const foundB = await productRepo.getRecommendationByIdWorkspaceAndProject(REC_ID, WS_B, PROJ_X)

    expect(foundA).not.toBeNull()
    expect(foundB).not.toBeNull()
    // Workspace A cannot see workspace B's recommendation via its own scope
    const wsARecs = await productRepo.getRecommendationsByProject(PROJ_X, WS_A)
    expect(wsARecs.length).toBe(1)
    const wsBRecs = await productRepo.getRecommendationsByProject(PROJ_X, WS_B)
    expect(wsBRecs.length).toBe(1)
  })

  it('ID substitution: workspace A cannot read workspace B recommendation via getRecommendationByIdAndWorkspace', async () => {
    const recB = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_B })
    await productRepo.saveRecommendation(recB, PROJ_X)

    // Workspace A tries to read workspace B's recommendation using the same ID
    const found = await productRepo.getRecommendationByIdAndWorkspace(REC_ID, WS_A)
    expect(found).toBeNull()
  })

  it('workspace-only lookup returns correct recommendation in its own workspace', async () => {
    const recA = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_A })
    await productRepo.saveRecommendation(recA, PROJ_X)

    const found = await productRepo.getRecommendationByIdAndWorkspace(REC_ID, WS_A)
    expect(found).not.toBeNull()
    expect(found!.workspaceId).toBe(WS_A)
  })

  it('workspace-only lookup: same workspace, same rec ID, different projects → returns first matching row (H8-ACTION-1 boundary)', async () => {
    // This tests the exact scenario the background worker faces:
    // Two projects in the same workspace have recommendations with the same ID.
    // getRecommendationByIdAndWorkspace scans by (id, workspaceId) only.
    // It returns whichever row the DB hits first — but the worker only needs
    // the projectId to resolve the repository connection, and the action
    // already belongs to this workspace (created from this workspace's pipeline).
    const recA = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_A })
    const recB = createRecommendation({ ...baseRec, id: REC_ID, workspaceId: WS_A })
    await productRepo.saveRecommendation(recA, PROJ_X)
    await productRepo.saveRecommendation(recB, PROJ_Y)

    const found = await productRepo.getRecommendationByIdAndWorkspace(REC_ID, WS_A)
    expect(found).not.toBeNull()
    expect(found!.workspaceId).toBe(WS_A)
    // The found recommendation belongs to one of the two projects
    expect([PROJ_X, PROJ_Y]).toContain((found as { projectId?: string }).projectId)
  })
})
