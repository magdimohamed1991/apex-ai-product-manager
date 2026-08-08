/**
 * Lightweight ProposedAction DTO for use in prompt building.
 * Each action is a concrete, implementable step derived from a Recommendation.
 */
export interface ProposedActionDTO {
  id: string
  title: string
  description: string
}

/**
 * Lightweight Recommendation DTO for use in prompt building.
 * Avoids importing full domain entities from @apex/ai-core into @apex/prompts.
 */
export interface RecommendationDTO {
  id: string
  title: string
  rationale: string
  impact: string
  effort: 'low' | 'medium' | 'high'
  priority: 'critical' | 'high' | 'medium' | 'low'
  confidence: number
  origin: 'insight' | 'finding'
  insightIds?: string[]
  findingIds?: string[]
  proposedActions: ProposedActionDTO[]
}
