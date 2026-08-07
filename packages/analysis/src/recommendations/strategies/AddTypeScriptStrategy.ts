import type { Insight, Recommendation, WorkspaceId } from '@apex/ai-core'
import type { RecommendationStrategy } from '../RecommendationStrategy'

export class AddTypeScriptStrategy implements RecommendationStrategy {
  readonly id = 'add-typescript'

  canHandle(insight: Insight): boolean {
    return insight.tags.includes('no-typescript')
  }

  recommend(insight: Insight, workspaceId: WorkspaceId): Recommendation {
    return {
      id: crypto.randomUUID(),
      workspaceId,
      title: 'Migrate to TypeScript',
      reason: 'The repository uses plain JavaScript without type safety.',
      impact: 'Reduces runtime errors and improves IDE support.',
      effort: 'high',
      priority: 'medium',
      confidence: 0.9,
      relatedFindings: [],
      createdAt: new Date(),
    }
  }
}
