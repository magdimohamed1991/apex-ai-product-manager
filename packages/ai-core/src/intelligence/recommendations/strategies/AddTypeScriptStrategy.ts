import type { Insight, Recommendation, WorkspaceId } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'

export class AddTypeScriptStrategy implements RecommendationStrategy {
  readonly id = 'add-typescript'

  canHandle(insight: Insight): boolean {
    return insight.tags.includes('no-typescript')
  }

  recommend(_insight: Insight, workspaceId: WorkspaceId): Recommendation {
    return {
      id: crypto.randomUUID(),
      workspaceId,
      origin: 'insight',
      title: 'Migrate to TypeScript',
      rationale: 'The repository uses plain JavaScript without type safety.',
      impact: 'Reduces runtime errors and improves IDE support.',
      effort: 'high',
      priority: 'medium',
      confidence: 0.9,
      insightIds: [],
      findingIds: [],
      proposedActions: [],
      createdAt: new Date(),
    }
  }
}
