export type { Workspace } from './Workspace'
export type { Integration, IntegrationConfig } from './Integration'
export type { Insight } from './Insight'
export type { Finding, FindingType } from './Finding'
export { createCorrelationFinding } from './Finding'
export type {
  Recommendation,
  EffortLevel,
  RecommendationOrigin,
  ProposedAction,
} from './Recommendation'
export { createRecommendation } from './Recommendation'
export type { Action, ActionTarget } from './Action'
export {
  createActionFromProposedAction,
  transitionAction,
  validateAction,
  validateActionTransition,
  VALID_ACTION_TRANSITIONS,
} from './Action'
export type { Explanation } from './Explanation'

// Milestone B & C: Execution & Action Transition Audit entities
export type { Execution, ExecutionStatus, ExecutionFailureClass, ExecutionError, RetryPolicy } from './Execution'
export { createExecution, validateExecution, DEFAULT_RETRY_POLICY, calculateBackoffDelay } from './Execution'

export type { ActionTransition } from './ActionTransition'
export { createActionTransitionRecord, validateActionTransitionRecord } from './ActionTransition'

export * from './ProductEntities'
export * from './ProductIntelligence'
export * from './ProductReasoning'
export * from './RecommendationOutcome'
export * from './ProductAdaptive'




