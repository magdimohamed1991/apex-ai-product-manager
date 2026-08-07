export type { RepositorySummary } from './repository/RepositorySummary'
export { StaticRepositoryAnalyzer } from './repository/StaticRepositoryAnalyzer'
export type { RepositoryFiles } from './repository/StaticRepositoryAnalyzer'

export type { Evidence, EvidenceType, EvidenceSource } from './evidence'
export { EvidenceCollector } from './evidence'

export type { Rule, RuleResult } from './rules'
export {
  RuleEngine,
  NoTestsRule,
  NoCIRule,
  NoDockerRule,
  MonorepoDetectedRule,
  NoTypeScriptRule,
} from './rules'

export { InsightMapper } from './mappers'

export type { RecommendationStrategy } from './recommendations'
export {
  RecommendationEngine,
  AddTestingStrategy,
  AddCIStrategy,
  AddTypeScriptStrategy,
} from './recommendations'

export { RepositoryDiscoveryPipeline } from './pipeline'
export type { PipelineInput, PipelineResult } from './pipeline'
