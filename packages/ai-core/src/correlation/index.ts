export { CorrelationEngine } from './CorrelationEngine'
export type { CorrelationCandidate } from './contracts/CorrelationCandidate'
export type { CorrelationRule } from './contracts/CorrelationRule'
export type { CorrelationResult } from './contracts/CorrelationResult'
export { MetricReviewCorrelationRule } from './rules/MetricReviewCorrelationRule'
export { MetricCodeCorrelationRule } from './rules/MetricCodeCorrelationRule'
export { CrossSourceCorrelationRule } from './rules/CrossSourceCorrelationRule'
export { scoreCorrelation, hasTemporalOverlap } from './scoring'
export { CorrelationFindingBuilder } from './mappers/CorrelationFindingBuilder'
export type {
  CorrelationFindingResult,
  BuilderValidationError,
  BuilderResult,
} from './mappers/CorrelationFindingBuilder'
