/**
 * A ModelProfile defines how an LLM should behave for a specific task.
 * Different tasks require different temperature, token limits, and reasoning.
 */
export interface ModelProfile {
  readonly id: string
  readonly model: string
  readonly temperature: number
  readonly maxTokens: number
  readonly reasoning: boolean // enable extended thinking / CoT
  readonly description: string
}

/**
 * For generating structured product intelligence summaries.
 * Low temperature = consistent, factual output.
 */
export const RepositorySummaryProfile: ModelProfile = {
  id: 'repository-summary',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 1500,
  reasoning: false,
  description: 'Structured summary of repository analysis',
}

/**
 * For architecture review — needs more creative reasoning.
 */
export const ArchitectureReviewProfile: ModelProfile = {
  id: 'architecture-review',
  model: 'gpt-4o',
  temperature: 0.3,
  maxTokens: 2000,
  reasoning: true,
  description: 'Deep architecture assessment',
}

/**
 * For roadmap generation — balances creativity and structure.
 */
export const RoadmapProfile: ModelProfile = {
  id: 'roadmap',
  model: 'gpt-4o',
  temperature: 0.4,
  maxTokens: 2500,
  reasoning: true,
  description: 'Product roadmap generation from insights',
}
