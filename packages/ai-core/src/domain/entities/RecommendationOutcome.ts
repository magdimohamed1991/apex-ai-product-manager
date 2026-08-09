import type { WorkspaceId } from '../value-objects'

export type OutcomeStatus =
  | 'PENDING'
  | 'VERIFIED_SUCCESS'
  | 'PARTIALLY_SUCCESSFUL'
  | 'FAILED'
  | 'NOT_VERIFIABLE'
  | 'REVERTED'

/**
 * RecommendationOutcome (Milestone H5)
 *
 * Domain entity representing the verified real-world result of an APEX product recommendation.
 * Bridges the gap between "execution success" (the tool ran) and "reality success" (the change happened).
 */
export interface RecommendationOutcome {
  id: string
  recommendationId: string
  workspaceId: WorkspaceId
  projectId: string
  actionId: string | null
  executionId: string | null
  status: OutcomeStatus
  detectedAt: Date
  resolvedAt: Date | null
  verificationStatus: string
  verificationEvidence: string[]
  outcomeSummary: string
}

export function createRecommendationOutcome(
  data: Omit<RecommendationOutcome, 'id' | 'detectedAt' | 'resolvedAt'> & {
    id?: string
    detectedAt?: Date
    resolvedAt?: Date | null
  }
): RecommendationOutcome {
  if (!data.recommendationId) {
    throw new Error('RecommendationOutcome must reference a valid recommendationId')
  }
  if (!data.workspaceId) {
    throw new Error('RecommendationOutcome must belong to a workspaceId')
  }
  if (!data.projectId) {
    throw new Error('RecommendationOutcome must belong to a projectId')
  }

  return {
    id: data.id ?? crypto.randomUUID(),
    recommendationId: data.recommendationId,
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    actionId: data.actionId ?? null,
    executionId: data.executionId ?? null,
    status: data.status,
    detectedAt: data.detectedAt ?? new Date(),
    resolvedAt: data.resolvedAt ?? null,
    verificationStatus: data.verificationStatus,
    verificationEvidence: data.verificationEvidence || [],
    outcomeSummary: data.outcomeSummary,
  }
}
