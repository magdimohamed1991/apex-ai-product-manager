import type { Insight, Recommendation, WorkspaceId } from '../../domain'

/**
 * A RecommendationStrategy maps an Insight to a Recommendation.
 * Each strategy handles one specific pattern.
 */
export interface RecommendationStrategy {
  readonly id: string
  canHandle(insight: Insight): boolean
  recommend(insight: Insight, workspaceId: WorkspaceId): Recommendation
}
