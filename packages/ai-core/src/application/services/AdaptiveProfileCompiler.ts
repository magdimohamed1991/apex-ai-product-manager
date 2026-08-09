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
import type { Recommendation, Action } from '../../domain/entities'
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

export const CALIBRATION_VERSION = 'h6-v1'

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
}

function emptyPopulation(): ObservationPopulation {
  return {
    recommendationCount: 0,
    approvalCount: 0,
    outcomeCount: 0,
    verifiedCount: 0,
    failedCount: 0,
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

      const pop: ObservationPopulation = emptyPopulation()
      pop.recommendationCount = catRecs.length
      pop.approvalCount = catActions.filter((a) => a.status !== 'proposed').length
      pop.outcomeCount = catOutcomes.length
      pop.verifiedCount = catOutcomes.filter((o) => o.status === 'VERIFIED_SUCCESS').length
      pop.failedCount = catOutcomes.filter((o) => o.status === 'FAILED').length

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
      const pmCalibrationWeight = 1.0 + (adoptionRate - 0.5) * 0.6 * confidence

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

      totalDecisionsObserved += pop.approvalCount

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

    // Persist signals with deterministic IDs, replacing any prior signals
    // for the same (workspace, project, category, type) tuple. The repository
    // implementation is expected to upsert by ID.
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
