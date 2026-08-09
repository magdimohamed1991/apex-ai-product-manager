import type { WorkspaceId } from '../../../domain/value-objects'
import type { Recommendation, RecommendationOutcome } from '../../../domain/entities'
import type { VerificationEvidence } from '../../../domain/entities/ProductAdaptive'

export interface VerificationContext {
  workspaceId: WorkspaceId
  projectId: string
  repositoryPath: string
  recommendation: Recommendation
  outcome: RecommendationOutcome
  evidence: VerificationEvidence
}

export interface VerificationResult {
  status: 'VERIFIED_SUCCESS' | 'FAILED' | 'NOT_VERIFIABLE'
  verificationStatus: string
  verificationEvidence: string[]
  outcomeSummary: string
}

export interface VerificationStrategy {
  canHandle(context: VerificationContext): boolean
  verify(context: VerificationContext): Promise<VerificationResult>
}
