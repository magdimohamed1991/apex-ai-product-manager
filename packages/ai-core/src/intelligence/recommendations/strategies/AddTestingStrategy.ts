import type { Insight, Recommendation, WorkspaceId } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'

export class AddTestingStrategy implements RecommendationStrategy {
  readonly id = 'add-testing'

  canHandle(insight: Insight): boolean {
    return insight.tags.includes('no-tests')
  }

  recommend(insight: Insight, workspaceId: WorkspaceId): Recommendation {
    return {
      id: crypto.randomUUID(),
      workspaceId,
      title: 'Introduce automated testing',
      reason: 'No test suite was detected in the repository.',
      impact: 'Reduces regression risk and enables safe refactoring.',
      effort: 'medium',
      priority: 'high',
      confidence: 0.95,
      relatedFindings: [],
      createdAt: new Date(),
    }
  }
}
