import type { Insight, Recommendation, WorkspaceId } from '../../domain'
import type { RecommendationStrategy } from './RecommendationStrategy'

/**
 * Applies registered strategies to a list of Insights.
 * Each strategy handles exactly one pattern — no if/else chains.
 */
export class RecommendationEngine {
  private readonly strategies: RecommendationStrategy[] = []

  register(strategy: RecommendationStrategy): this {
    this.strategies.push(strategy)
    return this
  }

  registerMany(strategies: RecommendationStrategy[]): this {
    strategies.forEach((s) => this.register(s))
    return this
  }

  generate(insights: Insight[], workspaceId: WorkspaceId): Recommendation[] {
    const recommendations: Recommendation[] = []
    for (const insight of insights) {
      for (const strategy of this.strategies) {
        if (strategy.canHandle(insight)) {
          recommendations.push(strategy.recommend(insight, workspaceId))
        }
      }
    }
    return recommendations
  }
}
