import type { Insight, Recommendation, WorkspaceId } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'

export class AddCIStrategy implements RecommendationStrategy {
  readonly id = 'add-ci'

  canHandle(insight: Insight): boolean {
    return insight.tags.includes('no-ci')
  }

  recommend(_insight: Insight, workspaceId: WorkspaceId): Recommendation {
    return {
      id: crypto.randomUUID(),
      workspaceId,
      origin: 'insight',
      title: 'Set up a CI pipeline',
      rationale: 'No GitHub Actions or CI configuration was found.',
      impact: 'Prevents broken code from reaching the main branch.',
      effort: 'low',
      priority: 'medium',
      confidence: 0.95,
      insightIds: [],
      findingIds: [],
      proposedActions: [],
      createdAt: new Date(),
    }
  }
}
