import type { WorkspaceId } from '../../domain/value-objects'
import { createRecommendationOutcome } from '../../domain/entities/RecommendationOutcome'
import type { RecommendationOutcome } from '../../domain/entities/RecommendationOutcome'
import type { RecommendationOutcomeRepository } from '../../domain/repositories/RecommendationOutcomeRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import { verificationRegistry } from './verification/VerificationStrategyRegistry'
import type { VerificationContext } from './verification/VerificationTypes'
import type { VerificationEvidence } from '../../domain/entities/ProductAdaptive'

export interface DecisionQualityMetrics {
  totalRecommendations: number
  totalApproved: number
  acceptanceRate: number
  totalOutcomes: number
  successCount: number
  successRate: number
  failedCount: number
  falsePositiveRate: number
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
   */
  async createOutcome(
    recommendationId: string,
    workspaceId: WorkspaceId,
    projectId: string,
    actionId: string | null = null,
    executionId: string | null = null
  ): Promise<RecommendationOutcome> {
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

    const totalRecommendations = recs.length

    // Acceptance Rate: approved/promoted actions vs total recommendations
    // generated. Actions MUST be scoped to the project via their linked
    // recommendation — counting all workspace actions would leak decisions
    // from other projects into this project's metrics.
    const projectRecIds = new Set(recs.map((r) => r.id))
    const projectActions = actions.filter((a) => projectRecIds.has(a.relatedRecommendationId))
    const totalApproved = projectActions.filter((a) => a.status !== 'proposed').length
    const acceptanceRate =
      totalRecommendations > 0 ? (totalApproved / totalRecommendations) * 100 : 0

    const totalOutcomes = outcomes.length
    const successCount = outcomes.filter((o) => o.status === 'VERIFIED_SUCCESS').length
    const successRate = totalOutcomes > 0 ? (successCount / totalOutcomes) * 100 : 0

    const failedCount = outcomes.filter((o) => o.status === 'FAILED').length
    const falsePositiveCount = outcomes.filter((o) => o.status === 'NOT_VERIFIABLE').length
    const falsePositiveRate = totalOutcomes > 0 ? (falsePositiveCount / totalOutcomes) * 100 : 0

    return {
      totalRecommendations,
      totalApproved,
      acceptanceRate: Math.round(acceptanceRate * 10) / 10,
      totalOutcomes,
      successCount,
      successRate: Math.round(successRate * 10) / 10,
      failedCount,
      falsePositiveRate: Math.round(falsePositiveRate * 10) / 10,
    }
  }
}
