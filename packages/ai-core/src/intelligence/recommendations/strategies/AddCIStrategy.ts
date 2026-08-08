import type { Recommendation, RecommendationOrigin } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'
import type { RecommendationInput } from '../RecommendationInput'

export class AddCIStrategy implements RecommendationStrategy {
  readonly id = 'add-ci'
  readonly supportedOrigins: RecommendationOrigin[] = ['insight']

  canHandle(input: RecommendationInput): boolean {
    return input.insight !== undefined && input.insight.tags.includes('no-ci')
  }

  recommend(input: RecommendationInput): Recommendation {
    const insight = input.insight!
    return {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      origin: 'insight',
      deduplicationKey: `${this.id}:insight:${insight.id}`,
      title: 'Set up a CI pipeline',
      rationale: 'No GitHub Actions or CI configuration was found.',
      impact: 'Prevents broken code from reaching the main branch.',
      effort: 'low',
      priority: 'medium',
      confidence: 0.95,
      insightIds: [insight.id],
      findingIds: [],
      proposedActions: [
        {
          id: `${insight.id}:add-github-actions`,
          title: 'Create GitHub Actions workflow',
          description: 'Add .github/workflows/ci.yml with lint, typecheck, test, and build steps.',
        },
      ],
      createdAt: new Date(),
    }
  }
}
