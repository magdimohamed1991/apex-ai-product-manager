import type { Recommendation, RecommendationOrigin } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'
import type { RecommendationInput } from '../RecommendationInput'

/**
 * Generic Finding → Recommendation strategy.
 * Handles any Finding and produces a Recommendation derived from the Finding itself,
 * preserving the full provenance chain.
 */
export class AddressFindingStrategy implements RecommendationStrategy {
  readonly id = 'address-finding'
  readonly supportedOrigins: RecommendationOrigin[] = ['finding']

  canHandle(input: RecommendationInput): boolean {
    return input.finding !== undefined
  }

  recommend(input: RecommendationInput): Recommendation {
    const finding = input.finding!
    return {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      origin: 'finding',
      title: `Address: ${finding.title}`,
      rationale: finding.description,
      impact: `Addresses ${finding.type} finding with ${finding.severity} severity.`,
      effort: 'medium',
      priority: finding.priority,
      confidence: 0.8,
      insightIds: [],
      findingIds: [finding.id],
      proposedActions: [],
      createdAt: new Date(),
    }
  }
}
