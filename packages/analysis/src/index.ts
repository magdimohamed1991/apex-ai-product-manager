// @apex/analysis — Low-level static analysis only.
// No imports from @apex/ai-core. Depends only on @apex/contracts.

export type { RepositorySummary } from './repository/RepositorySummary'
export { StaticRepositoryAnalyzer } from './repository/StaticRepositoryAnalyzer'
export type { RepositoryFiles } from './repository/StaticRepositoryAnalyzer'

export type { Evidence, EvidenceSourceReference } from './evidence/Evidence'
export { EvidenceCollector } from './evidence/EvidenceCollector'

export type { Rule, RuleResult } from './rules/Rule'
export {
  RuleEngine,
  NoTestsRule,
  NoCIRule,
  NoDockerRule,
  MonorepoDetectedRule,
  NoTypeScriptRule,
} from './rules'
