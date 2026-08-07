import type { Insight, Finding, Recommendation, WorkspaceId } from '../../domain'
import type { RecommendationStrategy } from './RecommendationStrategy'

/**
 * Applies registered strategies to a list of Insights and Findings.
 * Each strategy handles exactly one pattern — no if/else chains.
 * Strategies declare which origins they support via supportedOrigins.
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

  generate(insights: Insight[], findings: Finding[], workspaceId: WorkspaceId): Recommendation[] {
    const recommendations: Recommendation[] = []

    for (const insight of insights) {
      const input = { workspaceId, insight }
      for (const strategy of this.strategies) {
        if (!strategy.supportedOrigins.includes('insight')) continue
        if (strategy.canHandle(input)) {
          recommendations.push(strategy.recommend(input))
        }
      }
    }

    for (const finding of findings) {
      const input = { workspaceId, finding }
      for (const strategy of this.strategies) {
        if (!strategy.supportedOrigins.includes('finding')) continue
        if (strategy.canHandle(input)) {
          recommendations.push(strategy.recommend(input))
        }
      }
    }

    return recommendations
  }
}
