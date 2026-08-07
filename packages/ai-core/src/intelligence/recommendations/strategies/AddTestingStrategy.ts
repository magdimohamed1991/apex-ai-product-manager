import type { Recommendation, RecommendationOrigin } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'
import type { RecommendationInput } from '../RecommendationInput'

export class AddTestingStrategy implements RecommendationStrategy {
  readonly id = 'add-testing'
  readonly supportedOrigins: RecommendationOrigin[] = ['insight']

  canHandle(input: RecommendationInput): boolean {
    return input.insight !== undefined && input.insight.tags.includes('no-tests')
  }

  recommend(input: RecommendationInput): Recommendation {
    const insight = input.insight!
    return {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      origin: 'insight',
      title: 'Introduce automated testing',
      rationale: 'No test suite was detected in the repository.',
      impact: 'Reduces regression risk and enables safe refactoring.',
      effort: 'medium',
      priority: 'high',
      confidence: 0.95,
      insightIds: [insight.id],
      findingIds: [],
      proposedActions: [],
      createdAt: new Date(),
    }
  }
}
