export {
  ActionApplicationService,
  adapterRegistry,
  AdapterRegistry,
} from './services/ActionApplicationService'
export type {
  AdapterContext,
  AdapterExecutionResult,
  ActionTargetAdapter,
} from './services/ActionApplicationService'
export { ActionExecutor } from './services/ActionExecutor'
export { ActionExecutionWorker } from './services/ActionExecutionWorker'
export { PipelineActionOrchestrator } from './services/PipelineActionOrchestrator'
export type { PipelineRunResult } from './services/PipelineActionOrchestrator'
export { GitHubAdapter } from './services/adapters/GitHubAdapter'
export { JiraAdapter } from './services/adapters/JiraAdapter'
export { LinearAdapter } from './services/adapters/LinearAdapter'
export { SlackAdapter } from './services/adapters/SlackAdapter'
export { EnvCredentialProvider } from './services/CredentialProvider'
export type { CredentialProvider, ProviderCredentials } from './services/CredentialProvider'
export { APEXProductService } from './services/APEXProductService'
export type { ConnectionInput } from './services/APEXProductService'
export { ProductIntelligenceService } from './services/ProductIntelligenceService'
export { ProductReasoningService } from './services/ProductReasoningService'
export { RecommendationOutcomeService } from './services/RecommendationOutcomeService'
export type { DecisionQualityMetrics } from './services/RecommendationOutcomeService'
export { AdaptiveProfileCompiler } from './services/AdaptiveProfileCompiler'
export { H6PrioritizationCalibrator } from './services/H6PrioritizationCalibrator'
export { ProductValidationService } from './services/ProductValidationService'
export type { ProductValidationMetrics } from './services/ProductValidationService'
export { PMDecisionTelemetryService } from './services/PMDecisionTelemetryService'
export type {
  RecordDecisionInput,
  PMDecisionTelemetryStore,
} from './services/PMDecisionTelemetryService'

// H9–H12 intelligence application services
export { CompetitorIntelligenceService } from './services/CompetitorIntelligenceService'
export type { AddCompetitorInput } from './services/CompetitorIntelligenceService'
export { UXIntelligenceService } from './services/UXIntelligenceService'
export type { AddUserJourneyInput, AddFrictionPointInput } from './services/UXIntelligenceService'
export { BrowserIntelligenceService } from './services/BrowserIntelligenceService'
export { ExecutiveIntelligenceService } from './services/ExecutiveIntelligenceService'
export type { ExportResult } from './services/ExecutiveIntelligenceService'
export { ScheduledIntelligenceService } from './services/ScheduledIntelligenceService'
export type {
  CreateScheduledJobInput,
  UpdateScheduledJobInput,
} from './services/ScheduledIntelligenceService'
