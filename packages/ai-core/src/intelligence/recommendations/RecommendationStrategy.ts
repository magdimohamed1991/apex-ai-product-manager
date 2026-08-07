import type { Recommendation, RecommendationOrigin } from '../../domain'
import type { RecommendationInput } from './RecommendationInput'

export interface RecommendationStrategy {
  readonly id: string
  readonly supportedOrigins: RecommendationOrigin[]
  canHandle(input: RecommendationInput): boolean
  recommend(input: RecommendationInput): Recommendation
}
