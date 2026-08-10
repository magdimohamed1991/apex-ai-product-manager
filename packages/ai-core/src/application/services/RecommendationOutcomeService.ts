import type { WorkspaceId } from '../../domain/value-objects'
import { createRecommendationOutcome } from '../../domain/entities/RecommendationOutcome'
import type { RecommendationOutcome } from '../../domain/entities/RecommendationOutcome'
import type { Recommendation } from '../../domain/entities/Recommendation'
import type { RecommendationOutcomeRepository } from '../../domain/repositories/RecommendationOutcomeRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import { verificationRegistry } from './verification/VerificationStrategyRegistry'
import type { VerificationContext } from './verification/VerificationTypes'
import type { VerificationEvidence } from '../../domain/entities/ProductAdaptive'

export interface DecisionQualityMetrics {
  /** Recommendation population (total recommendations presented) */
  totalRecommendations: number
  /** Execution population: actions promoted past `proposed` */
  totalApproved: number
  /**
   * PM Decision population: ACCEPT telemetry / total decision telemetry.
   * Derived ONLY from PMDecisionTelemetry records — never from actions or
   * recommendations (H7 measurement integrity).
   */
  decisionCount: number
  acceptCount: number
  rejectCount: number
  deferCount: number
  overrideCount: number
  acceptanceRate: number
  /** Outcome population */
  totalOutcomes: number
  successCount: number
  successRate: number
  failedCount: number
  /**
   * Percent of outcomes that could NOT be verified (NOT_VERIFIABLE).
   * Deliberately NOT named "false positive rate": an unverifiable outcome
   * means the system could not confirm success — it does not mean the
   * recommendation was wrong.
   */
  unverifiableRate: number
}

/**
 * Recommendation Outcome Service (Milestone H5)
 *
 * Implements the reality-verification scan, closed-loop outcome lifecycle,
 * and decision-quality metrics calculation. Completely decoupled from execution.
 */
export class RecommendationOutcomeService {
  constructor(
    private readonly outcomeRepository: RecommendationOutcomeRepository,
    private readonly productRepository: ProductRepository,
    private readonly actionRepository: ActionRepository
  ) {}

  /**
   * Tracks and persists an initial pending outcome for an approved recommendation
   *
   * Project-scoping invariant: the recommendation must exist in the workspace
   * AND its persisted project must match the claimed `projectId`. Without this
   * check a workspace member could attach an outcome for a recommendation of
   * project A to project B, contaminating B's outcome metrics (H2: projectId
   * is never ignored; H5: verification is project-scoped).
   */
  async createOutcome(
    recommendationId: string,
    workspaceId: WorkspaceId,
    projectId: string,
    actionId: string | null = null,
    executionId: string | null = null
  ): Promise<RecommendationOutcome> {
    const rec = await this.productRepository.getRecommendationByIdAndWorkspace(
      recommendationId,
      workspaceId
    )
    if (!rec) {
      throw new Error(
        `Recommendation "${recommendationId}" not found in workspace "${workspaceId}"; cannot create an outcome for a non-existent recommendation.`
      )
    }
    // Persisted recommendation rows carry the owning project id (StoredRecommendation).
    const recProjectId = (rec as Recommendation & { projectId?: string }).projectId
    if (!recProjectId || recProjectId !== projectId) {
      throw new Error(
        `Recommendation "${recommendationId}" belongs to project "${recProjectId ?? '(unknown)'}", not the claimed project "${projectId}". Outcome creation rejected.`
      )
    }

    const outcome = createRecommendationOutcome({
      recommendationId,
      workspaceId,
      projectId,
      actionId,
      executionId,
      status: 'PENDING',
      verificationStatus: 'Pending next repository analysis scan.',
      verificationEvidence: [],
      outcomeSummary: 'Awaiting codebase verification scan.',
    })

    await this.outcomeRepository.save(outcome)
    return outcome
  }

  /**
   * Reality-Verification Scan: compares before/after codebase evidence using open verification strategies (Item 6)
   */
  async verifyOutcome(
    outcomeId: string,
    workspaceId: WorkspaceId,
    filesAfterChange: VerificationEvidence
  ): Promise<RecommendationOutcome> {
    const outcome = await this.outcomeRepository.getByIdAndWorkspace(outcomeId, workspaceId)
    if (!outcome) {
      throw new Error(`Outcome "${outcomeId}" not found in workspace "${workspaceId}"`)
    }

    const rec = await this.productRepository.getRecommendationByIdAndWorkspace(
      outcome.recommendationId,
      workspaceId
    )
    if (!rec) {
      // If the recommendation was deleted/absent, outcome remains unverifiable (Item 4)
      outcome.status = 'NOT_VERIFIABLE'
      outcome.verificationStatus = 'Factual recommendation details are missing.'
      await this.outcomeRepository.save(outcome)
      return outcome
    }

    // Build standard typed VerificationContext
    const context: VerificationContext = {
      workspaceId,
      projectId: outcome.projectId,
      repositoryPath: '.',
      recommendation: rec,
      outcome,
      evidence: filesAfterChange,
    }

    // Find and execute corresponding strategy from registry (Item 6)
    const strategy = verificationRegistry.findStrategy(context)
    const result = await strategy.verify(context)

    // Update outcome state with trace-backed reality evidence (Item 5)
    outcome.status = result.status
    outcome.resolvedAt = result.status === 'VERIFIED_SUCCESS' ? new Date() : null
    outcome.verificationStatus = result.verificationStatus
    outcome.verificationEvidence = result.verificationEvidence
    outcome.outcomeSummary = result.outcomeSummary

    await this.outcomeRepository.save(outcome)
    return outcome
  }

  async getByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<RecommendationOutcome[]> {
    return this.outcomeRepository.getByProject(projectId, workspaceId)
  }

  /**
   * Compiles empirical PM decision quality and accept rate metrics (Item 6)
   */
  async getDecisionQualityMetrics(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<DecisionQualityMetrics> {
    const recs = await this.productRepository.getRecommendationsByProject(projectId, workspaceId)
    const outcomes = await this.outcomeRepository.getByProject(projectId, workspaceId)
    const actions = await this.actionRepository.getByWorkspace({ workspaceId })
    const telemetry = await this.productRepository.getPMDecisionTelemetryByProject(
      projectId,
      workspaceId
    )

    // Recommendation population (informational only).
    const totalRecommendations = recs.length

    // Execution population: approved/promoted actions vs total
    // recommendations generated. Actions MUST be scoped to the project via
    // their linked recommendation — counting all workspace actions would
    // leak decisions from other projects into this project's metrics.
    const projectRecIds = new Set(recs.map((r) => r.id))
    const projectActions = actions.filter((a) => projectRecIds.has(a.relatedRecommendationId))
    const totalApproved = projectActions.filter((a) => a.status !== 'proposed').length

    // PM Decision population: acceptance is ACCEPT telemetry / total
    // decision telemetry. Never mixed with actions or recommendations
    // (H7 measurement integrity). 0 when no telemetry exists.
    const decisionCount = telemetry.length
    const acceptCount = telemetry.filter((t) => t.decision === 'ACCEPT').length
    const rejectCount = telemetry.filter((t) => t.decision === 'REJECT').length
    const deferCount = telemetry.filter((t) => t.decision === 'DEFER').length
    const overrideCount = telemetry.filter((t) => t.decision === 'OVERRIDE').length
    const acceptanceRate = decisionCount > 0 ? (acceptCount / decisionCount) * 100 : 0

    // Outcome population.
    const totalOutcomes = outcomes.length
    const successCount = outcomes.filter((o) => o.status === 'VERIFIED_SUCCESS').length
    const successRate = totalOutcomes > 0 ? (successCount / totalOutcomes) * 100 : 0

    const failedCount = outcomes.filter((o) => o.status === 'FAILED').length
    const unverifiableCount = outcomes.filter((o) => o.status === 'NOT_VERIFIABLE').length
    const unverifiableRate = totalOutcomes > 0 ? (unverifiableCount / totalOutcomes) * 100 : 0

    return {
      totalRecommendations,
      totalApproved,
      decisionCount,
      acceptCount,
      rejectCount,
      deferCount,
      overrideCount,
      acceptanceRate: Math.round(acceptanceRate * 10) / 10,
      totalOutcomes,
      successCount,
      successRate: Math.round(successRate * 10) / 10,
      failedCount,
      unverifiableRate: Math.round(unverifiableRate * 10) / 10,
    }
  }
}
