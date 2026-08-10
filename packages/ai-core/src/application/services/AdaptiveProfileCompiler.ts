import { createHash } from 'node:crypto'
import type { WorkspaceId } from '../../domain/value-objects'
import type {
  AdaptiveLearningProfile,
  LearningSignal,
  CategoryCoefficient,
} from '../../domain/entities/ProductAdaptive'
import type { AdaptiveLearningProfileRepository } from '../../domain/repositories/AdaptiveLearningProfileRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import type { RecommendationOutcomeRepository } from '../../domain/repositories/RecommendationOutcomeRepository'
import type { Recommendation, Action, PMDecisionTelemetry } from '../../domain/entities'
import { Logger } from '../../observability/Logger'

const log = new Logger('h6.compiler')

/**
 * The deterministic, typed category enum that recommendation.metadata
 * may carry. Older code matched categories by title substring, which is
 * brittle and bypasses the explicit category metadata. We now require
 * the metadata field to be present and valid; if not, the recommendation
 * is not eligible for category-level learning.
 */
export const SUPPORTED_CATEGORIES = ['TESTING', 'CI_CD', 'TYPESCRIPT', 'DOCKER'] as const
export type SupportedCategory = (typeof SUPPORTED_CATEGORIES)[number]

/**
 * Version of the calibration algorithm that produced the signals/profile.
 * h6-v2: the calibrator now consumes H7 telemetry-derived signal VALUES
 * (ACCEPTANCE / REJECTION / DEFER / OVERRIDE rates and the mean signed
 * override delta) in addition to the adoption/outcome evidence, while
 * DECISION_LATENCY remains observational-only.
 */
export const CALIBRATION_VERSION = 'h6-v2'

/**
 * Empirical minimum-observation rule. Below this many decisions/outcomes
 * in a category, that category is NOT eligible to influence calibration.
 * The category coefficient is still computed for transparency, but the
 * calibrator will treat it as `insufficient_evidence`.
 */
export const MIN_OBSERVATIONS_FOR_FAVORED = 5
export const MIN_OBSERVATIONS_FOR_IGNORED = 5
export const MIN_OBSERVATIONS_FOR_SIGNAL = 3

function isSupportedCategory(value: unknown): value is SupportedCategory {
  return typeof value === 'string' && (SUPPORTED_CATEGORIES as readonly string[]).includes(value)
}

function recommendationCategory(rec: Recommendation): SupportedCategory | null {
  // Prefer the explicit, typed metadata field. If the upstream pipeline
  // did not supply a typed category, the recommendation is excluded from
  // category-level learning. (Older code matched by title substring, which
  // is brittle and bypasses the explicit category metadata.)
  const meta = (rec as Recommendation & { category?: unknown }).category
  if (isSupportedCategory(meta)) return meta
  return null
}

interface ObservationPopulation {
  recommendationCount: number
  approvalCount: number
  outcomeCount: number
  verifiedCount: number
  failedCount: number
  /** Real PM decision count from H7 telemetry stream */
  decisionCount: number
  acceptCount: number
  rejectCount: number
  deferCount: number
  overrideCount: number
}

function emptyPopulation(): ObservationPopulation {
  return {
    recommendationCount: 0,
    approvalCount: 0,
    outcomeCount: 0,
    verifiedCount: 0,
    failedCount: 0,
    decisionCount: 0,
    acceptCount: 0,
    rejectCount: 0,
    deferCount: 0,
    overrideCount: 0,
  }
}

function smoothConfidence(n: number): number {
  // Statistical safeguard from H6 invariant: n / (n + 10) — note this is a
  // bounded heuristic, NOT a Bayesian posterior. We use it only to
  // dampen weight updates from small samples, not to claim statistical
  // significance.
  return n > 0 ? n / (n + 10) : 0
}

function stableSignalId(
  workspaceId: string,
  projectId: string,
  category: SupportedCategory,
  type: LearningSignal['type'],
  sourceHash: string
): string {
  // Deterministic signal identity. Repeated compilation with the same
  // observation set must produce the same logical signal.
  const h = createHash('sha256')
    .update(`${workspaceId}|${projectId}|${category}|${type}|${sourceHash}`)
    .digest('hex')
  return `sig-${h.slice(0, 24)}`
}

function hashIds(ids: string[]): string {
  return createHash('sha256').update(ids.slice().sort().join('|')).digest('hex')
}

/**
 * Adaptive Profile Compiler (Milestone H6)
 *
 * Compiles empirical learning signals from real observations only:
 *   - adoption: PMs actually approved actions linked to a recommendation
 *   - execution success: actions reached `completed` status
 *   - outcome verification: RecommendationOutcome reached VERIFIED_SUCCESS
 *
 * Hardening contract (Milestone I - Production Hardening):
 *   1. Categories come from typed metadata, not title substring matching.
 *   2. `executionSuccessRate` is calculated from real Execution outcomes.
 *   3. LearningSignal IDs are deterministic (sha256 over the source
 *      observation set) so repeated compilation with unchanged data is
 *      idempotent and does not create duplicate logically-identical signals.
 *   4. `favoredCategories` / `ignoredCategories` only fire when the
 *      minimum-observation threshold is met; otherwise the category is
 *      marked `insufficient_evidence`.
 *   5. `calibrationVersion` is recorded so historical scores remain
 *      reproducible even if future formulas change.
 */
export class AdaptiveProfileCompiler {
  constructor(
    private readonly profileRepository: AdaptiveLearningProfileRepository,
    private readonly productRepository: ProductRepository,
    private readonly actionRepository: ActionRepository,
    private readonly outcomeRepository: RecommendationOutcomeRepository
  ) {}

  async compileProfile(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<AdaptiveLearningProfile> {
    const recs = await this.productRepository.getRecommendationsByProject(projectId, workspaceId)
    const actions = await this.actionRepository.getByWorkspace({ workspaceId })
    const outcomes = await this.outcomeRepository.getByProject(projectId, workspaceId)

    // H7: Fetch real PM decision telemetry from the H7 telemetry stream.
    // This is the ONLY source of REJECT/DEFER/OVERRIDE observations.
    // Previously the compiler only observed approvals (via action status),
    // which made rejections invisible to H6.
    const telemetry = await this.productRepository.getPMDecisionTelemetryByProject(
      projectId,
      workspaceId
    )

    // Build a recommendation lookup and a derived category index.
    const recById = new Map<string, Recommendation>()
    for (const r of recs) recById.set(r.id, r)

    const signals: LearningSignal[] = []
    const categoryCoefficients: CategoryCoefficient[] = []

    let totalDecisionsObserved = 0

    for (const cat of SUPPORTED_CATEGORIES) {
      // Filter recs explicitly to those with a known category.
      const catRecs = recs.filter((r) => recommendationCategory(r) === cat)
      const catRecIds = new Set(catRecs.map((r) => r.id))

      // Map of action -> its recommendation, only for recs in this category.
      const catActions: Action[] = actions.filter((a) => catRecIds.has(a.relatedRecommendationId))
      const catOutcomes = outcomes.filter((o) => catRecIds.has(o.recommendationId))

      // H7: PM decision telemetry for this category's recommendations.
      // This is the primary source for REJECT/DEFER/OVERRIDE signals.
      const catTelemetry: PMDecisionTelemetry[] = telemetry.filter((t) =>
        catRecIds.has(t.recommendationId)
      )

      const pop: ObservationPopulation = emptyPopulation()
      pop.recommendationCount = catRecs.length
      pop.approvalCount = catActions.filter((a) => a.status !== 'proposed').length
      pop.outcomeCount = catOutcomes.length
      pop.verifiedCount = catOutcomes.filter((o) => o.status === 'VERIFIED_SUCCESS').length
      pop.failedCount = catOutcomes.filter((o) => o.status === 'FAILED').length

      // H7 decision telemetry counts — the ONLY source of REJECT/DEFER/OVERRIDE.
      pop.decisionCount = catTelemetry.length
      pop.acceptCount = catTelemetry.filter((t) => t.decision === 'ACCEPT').length
      pop.rejectCount = catTelemetry.filter((t) => t.decision === 'REJECT').length
      pop.deferCount = catTelemetry.filter((t) => t.decision === 'DEFER').length
      pop.overrideCount = catTelemetry.filter((t) => t.decision === 'OVERRIDE').length

      // Real execution success rate, computed from real action outcomes.
      // Actions that reached `completed` are successes; everything else
      // (failed, in-progress, queued, proposed) is NOT a success.
      const completedCount = catActions.filter((a) => a.status === 'completed').length
      const terminalCount = catActions.filter(
        (a) => a.status === 'completed' || a.status === 'failed'
      ).length
      const executionSuccessRate = terminalCount > 0 ? completedCount / terminalCount : 0

      // PM calibration: weight scales with adoption rate * confidence.
      // The dampener ensures low-N categories cannot produce a strong swing.
      const adoptionRate =
        pop.recommendationCount > 0 ? pop.approvalCount / pop.recommendationCount : 0
      const outcomeVerifiedRate = pop.outcomeCount > 0 ? pop.verifiedCount / pop.outcomeCount : 0
      const confidence = smoothConfidence(pop.recommendationCount)
      // Range: 0.85 to 1.15; bounded by confidence so we never inflate
      // a single data point into a strong signal.
      // Hard clamp to the documented [0.85, 1.15] range. Without the clamp
      // the asymptote at n → ∞ with 100% adoption reaches ≈1.30, exceeding
      // the bound this comment block claims and amplifying noise at scale.
      const pmCalibrationWeight = Math.min(
        1.15,
        Math.max(0.85, 1.0 + (adoptionRate - 0.5) * 0.6 * confidence)
      )

      const evidenceState: 'observed' | 'estimated' | 'insufficient_evidence' =
        pop.recommendationCount < MIN_OBSERVATIONS_FOR_FAVORED
          ? 'insufficient_evidence'
          : 'observed'

      categoryCoefficients.push({
        category: cat,
        adoptionRate: Math.round(adoptionRate * 100) / 100,
        executionSuccessRate: Math.round(executionSuccessRate * 100) / 100,
        outcomeVerifiedRate: Math.round(outcomeVerifiedRate * 100) / 100,
        pmCalibrationWeight: Math.round(pmCalibrationWeight * 100) / 100,
      })

      // totalDecisionsObserved counts REAL PM decisions from the H7 telemetry
      // stream when available. Falls back to legacy approval count (actions
      // not in 'proposed' state) when no telemetry exists. This preserves
      // backward compatibility with existing tests while properly counting
      // when the H7 telemetry stream is active.
      totalDecisionsObserved += pop.decisionCount > 0 ? pop.decisionCount : pop.approvalCount

      // Deterministic learning signals. We only generate signals when
      // the observation count is above MIN_OBSERVATIONS_FOR_SIGNAL.
      if (pop.recommendationCount >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const sourceHash = hashIds(Array.from(catRecIds))
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'ADOPTION', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'ADOPTION',
          observationCount: pop.recommendationCount,
          value: adoptionRate,
          confidence: smoothConfidence(pop.recommendationCount),
          sourceRecommendationIds: Array.from(catRecIds),
          generatedAt: new Date(),
          evidenceState,
          calibrationVersion: CALIBRATION_VERSION,
        })
      }
      if (pop.outcomeCount >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const sourceHash = hashIds(catOutcomes.map((o) => o.id))
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'OUTCOME_SUCCESS', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'OUTCOME_SUCCESS',
          observationCount: pop.outcomeCount,
          value: outcomeVerifiedRate,
          confidence: smoothConfidence(pop.outcomeCount),
          sourceRecommendationIds: catOutcomes.map((o) => o.recommendationId),
          generatedAt: new Date(),
          evidenceState:
            pop.outcomeCount < MIN_OBSERVATIONS_FOR_FAVORED ? 'insufficient_evidence' : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }
      if (terminalCount >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const sourceHash = hashIds(catActions.map((a) => a.id))
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'EXECUTION_SUCCESS', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'EXECUTION_SUCCESS',
          observationCount: terminalCount,
          value: executionSuccessRate,
          confidence: smoothConfidence(terminalCount),
          sourceRecommendationIds: catActions.map((a) => a.relatedRecommendationId),
          generatedAt: new Date(),
          evidenceState:
            terminalCount < MIN_OBSERVATIONS_FOR_FAVORED ? 'insufficient_evidence' : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }

      // --- H7 decision-telemetry-derived signals ---
      // These signals are generated from the real PMDecisionTelemetry stream
      // and make ACCEPT/REJECT/DEFER/OVERRIDE observations visible to H6.
      // Every telemetry-derived signal carries `sourceTelemetryIds`: the
      // exact persisted PMDecisionTelemetry.id values that produced it, so
      // the H7 observation population is fully auditable from the signal.

      // ACCEPTANCE signal: PM explicitly accepted recommendations in this
      // category. Derived from the H7 telemetry population ONLY (ACCEPT
      // telemetry / total decision telemetry) — never from action status.
      if (pop.decisionCount >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const acceptTelemetry = catTelemetry.filter((t) => t.decision === 'ACCEPT')
        const acceptTelemetryIds = acceptTelemetry.map((t) => t.id)
        const sourceHash = hashIds(acceptTelemetryIds)
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'ACCEPTANCE', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'ACCEPTANCE',
          observationCount: pop.decisionCount,
          value: pop.decisionCount > 0 ? pop.acceptCount / pop.decisionCount : 0,
          confidence: smoothConfidence(pop.decisionCount),
          sourceRecommendationIds: acceptTelemetry.map((t) => t.recommendationId),
          sourceTelemetryIds: acceptTelemetryIds,
          generatedAt: new Date(),
          evidenceState:
            pop.decisionCount < MIN_OBSERVATIONS_FOR_FAVORED ? 'insufficient_evidence' : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }

      // REJECTION signal: PM explicitly rejected recommendations in this category.
      if (pop.rejectCount >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const rejectTelemetry = catTelemetry.filter((t) => t.decision === 'REJECT')
        const rejectTelemetryIds = rejectTelemetry.map((t) => t.id)
        const sourceHash = hashIds(rejectTelemetryIds)
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'REJECTION', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'REJECTION',
          observationCount: pop.rejectCount,
          value: pop.decisionCount > 0 ? pop.rejectCount / pop.decisionCount : 0,
          confidence: smoothConfidence(pop.rejectCount),
          sourceRecommendationIds: rejectTelemetry.map((t) => t.recommendationId),
          sourceTelemetryIds: rejectTelemetryIds,
          generatedAt: new Date(),
          evidenceState:
            pop.rejectCount < MIN_OBSERVATIONS_FOR_FAVORED ? 'insufficient_evidence' : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }

      // DEFER signal: PM deferred decisions in this category.
      if (pop.deferCount >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const deferTelemetry = catTelemetry.filter((t) => t.decision === 'DEFER')
        const deferTelemetryIds = deferTelemetry.map((t) => t.id)
        const sourceHash = hashIds(deferTelemetryIds)
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'DEFER', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'DEFER',
          observationCount: pop.deferCount,
          value: pop.decisionCount > 0 ? pop.deferCount / pop.decisionCount : 0,
          confidence: smoothConfidence(pop.deferCount),
          sourceRecommendationIds: deferTelemetry.map((t) => t.recommendationId),
          sourceTelemetryIds: deferTelemetryIds,
          generatedAt: new Date(),
          evidenceState:
            pop.deferCount < MIN_OBSERVATIONS_FOR_FAVORED ? 'insufficient_evidence' : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }

      // OVERRIDE signal: PM overrode APEX priority in this category.
      if (pop.overrideCount >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const overrideTelemetry = catTelemetry.filter((t) => t.decision === 'OVERRIDE')
        const overrideTelemetryIds = overrideTelemetry.map((t) => t.id)
        const sourceHash = hashIds(overrideTelemetryIds)
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'OVERRIDE', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'OVERRIDE',
          observationCount: pop.overrideCount,
          value: pop.decisionCount > 0 ? pop.overrideCount / pop.decisionCount : 0,
          confidence: smoothConfidence(pop.overrideCount),
          sourceRecommendationIds: overrideTelemetry.map((t) => t.recommendationId),
          sourceTelemetryIds: overrideTelemetryIds,
          generatedAt: new Date(),
          evidenceState:
            pop.overrideCount < MIN_OBSERVATIONS_FOR_FAVORED ? 'insufficient_evidence' : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }

      // DECISION_LATENCY signal: average PM decision window in this category.
      // OBSERVATIONAL ONLY: the calibration contract does not interpret
      // "faster = better", so this signal is persisted for auditability and
      // is included in appliedSignals, but it never modifies scores.
      if (catTelemetry.length >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const latenciesMs = catTelemetry.map(
          (t) => t.decisionCompletedAt.getTime() - t.decisionStartedAt.getTime()
        )
        const avgLatencySec = latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length / 1000
        const allTelemetryIds = catTelemetry.map((t) => t.id)
        const sourceHash = hashIds(allTelemetryIds)
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'DECISION_LATENCY', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'DECISION_LATENCY',
          observationCount: catTelemetry.length,
          value: Math.round(avgLatencySec * 10) / 10,
          confidence: smoothConfidence(catTelemetry.length),
          sourceRecommendationIds: catTelemetry.map((t) => t.recommendationId),
          sourceTelemetryIds: allTelemetryIds,
          generatedAt: new Date(),
          evidenceState:
            catTelemetry.length < MIN_OBSERVATIONS_FOR_FAVORED
              ? 'insufficient_evidence'
              : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }

      // PRIORITY_OVERRIDE_DELTA signal: average |H6 - PM| when override
      // occurred (magnitude), plus the signed mean so the calibrator can
      // distinguish "small consistent corrections" from "large systematic
      // corrections" WITH direction. Both are computed over the exact same
      // telemetry records (ids in `sourceTelemetryIds`).
      const deltaTelemetry = catTelemetry.filter(
        (t) => t.decision === 'OVERRIDE' && t.overrideDelta !== undefined
      )
      if (deltaTelemetry.length >= MIN_OBSERVATIONS_FOR_SIGNAL) {
        const overrideDeltas = deltaTelemetry.map((t) => t.overrideDelta as number)
        const avgDelta = overrideDeltas.reduce((a, b) => a + b, 0) / overrideDeltas.length
        const signedDeltas = deltaTelemetry
          .map((t) =>
            t.pmSelectedPriority !== undefined
              ? t.pmSelectedPriority - t.calibratedH6Score
              : undefined
          )
          .filter((d): d is number => d !== undefined)
        const avgSignedDelta =
          signedDeltas.length > 0
            ? signedDeltas.reduce((a, b) => a + b, 0) / signedDeltas.length
            : undefined
        const deltaTelemetryIds = deltaTelemetry.map((t) => t.id)
        const sourceHash = hashIds(deltaTelemetryIds)
        signals.push({
          id: stableSignalId(workspaceId, projectId, cat, 'PRIORITY_OVERRIDE_DELTA', sourceHash),
          workspaceId,
          projectId,
          category: cat,
          type: 'PRIORITY_OVERRIDE_DELTA',
          observationCount: deltaTelemetry.length,
          value: Math.round(avgDelta * 100) / 100,
          confidence: smoothConfidence(deltaTelemetry.length),
          sourceRecommendationIds: deltaTelemetry.map((t) => t.recommendationId),
          sourceTelemetryIds: deltaTelemetryIds,
          meanSignedOverrideDelta:
            avgSignedDelta !== undefined ? Math.round(avgSignedDelta * 100) / 100 : undefined,
          generatedAt: new Date(),
          evidenceState:
            deltaTelemetry.length < MIN_OBSERVATIONS_FOR_FAVORED
              ? 'insufficient_evidence'
              : 'observed',
          calibrationVersion: CALIBRATION_VERSION,
        })
      }
    }

    // Favored/Ignored: only emitted when min observation threshold is met.
    // We recompute population counts here (they are not stored on the
    // coefficient type to keep the public type stable).
    const populationByCategory = new Map<SupportedCategory, number>()
    for (const cat of SUPPORTED_CATEGORIES) {
      const catRecIds = new Set(
        recs.filter((r) => recommendationCategory(r) === cat).map((r) => r.id)
      )
      populationByCategory.set(
        cat,
        actions.filter((a) => catRecIds.has(a.relatedRecommendationId) && a.status !== 'proposed')
          .length
      )
    }
    const favoredCategories = categoryCoefficients
      .filter((c) => {
        const pop = populationByCategory.get(c.category as SupportedCategory) ?? 0
        return pop >= MIN_OBSERVATIONS_FOR_FAVORED && c.adoptionRate >= 0.75
      })
      .map((c) => c.category)
    const ignoredCategories = categoryCoefficients
      .filter((c) => {
        const pop = populationByCategory.get(c.category as SupportedCategory) ?? 0
        return pop >= MIN_OBSERVATIONS_FOR_IGNORED && c.adoptionRate < 0.25
      })
      .map((c) => c.category)

    // Note: we do NOT classify via title substring any more. The
    // recommendation object must carry a typed category field.

    const profile: AdaptiveLearningProfile = {
      workspaceId,
      projectId,
      totalDecisionsObserved,
      lastCalculatedAt: new Date(),
      PMPreferences: { favoredCategories, ignoredCategories },
      categoryCoefficients,
      biasAdjustments: {
        overPrioritizedLowEffort: false,
        favoredHighImpact: false,
      },
      calibrationVersion: CALIBRATION_VERSION,
    }

    // Signals are a PURE function of the current observation set: first
    // remove every previously compiled signal for this project, then persist
    // the freshly generated ones. Without the deletion, a category that
    // disappears (or drops below the generation threshold) would leave stale
    // signals behind that still influence the calibrator.
    await this.profileRepository.deleteSignalsByProject(workspaceId, projectId)
    if (signals.length > 0) {
      await this.profileRepository.saveSignals(signals)
    }
    await this.profileRepository.saveProfile(profile)

    log.info('Profile compiled', {
      workspaceId,
      projectId,
      totalDecisionsObserved,
      signalsGenerated: signals.length,
    })

    return profile
  }
}
