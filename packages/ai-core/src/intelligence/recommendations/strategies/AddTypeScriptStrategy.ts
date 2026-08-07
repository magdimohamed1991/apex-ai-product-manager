import type { Recommendation, RecommendationOrigin } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'
import type { RecommendationInput } from '../RecommendationInput'

export class AddTypeScriptStrategy implements RecommendationStrategy {
  readonly id = 'add-typescript'
  readonly supportedOrigins: RecommendationOrigin[] = ['insight']

  canHandle(input: RecommendationInput): boolean {
    return input.insight !== undefined && input.insight.tags.includes('no-typescript')
  }

  recommend(input: RecommendationInput): Recommendation {
    const insight = input.insight!
    return {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      origin: 'insight',
      title: 'Migrate to TypeScript',
      rationale: 'The repository uses plain JavaScript without type safety.',
      impact: 'Reduces runtime errors and improves IDE support.',
      effort: 'high',
      priority: 'medium',
      confidence: 0.9,
      insightIds: [insight.id],
      findingIds: [],
      proposedActions: [],
      createdAt: new Date(),
    }
  }
}
