export { buildRepositoryIntelligencePrompt } from './builders/repositoryIntelligencePrompt'

export { PromptRenderer } from './renderer/PromptRenderer'
export type { RenderedPrompt } from './renderer/PromptRenderer'

export { PromptRegistry, promptRegistry } from './registry/PromptRegistry'

export type {
  RepositoryAssessment,
  AssessmentRisk,
  TechnicalDebtAssessment,
  EngineeringPriority,
} from './contracts'

export type { RepositoryPromptVariables } from './variables/repository'
export {
  serializeSummary,
  serializeEvidence,
  serializeInsights,
  serializeFindings,
  serializeRecommendations,
} from './variables/repository'
