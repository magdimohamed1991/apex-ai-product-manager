import type { WorkspaceId, ActionStatus } from '../value-objects'
import type { Recommendation, ProposedAction } from './Recommendation'

export type ActionTarget = 'jira' | 'linear' | 'github' | 'internal' | 'slack'

export type ActionActor = 'user' | 'system' | 'executor' | 'recovery'

export const ALL_ACTION_TARGETS: ActionTarget[] = ['jira', 'linear', 'github', 'internal', 'slack']

/**
 * An Action is an accepted, tracked unit of executable work inside a Workspace.
 *
 * It represents work that has been promoted from an AI recommendation,
 * and maintains its own state machine and connection targets.
 */
export interface Action {
  id: string
  workspaceId: WorkspaceId
  title: string
  description: string
  target: ActionTarget
  status: ActionStatus
  relatedRecommendationId: string // Must reference a Recommendation ID (Strict Provenance)
  relatedProposedActionId: string // Must reference a ProposedAction ID (Strict Provenance)
  idempotencyKey: string // format: `promo:${workspaceId}:${relatedRecommendationId}:${relatedProposedActionId}`
  claimedByExecutionId: string | null // Id of the Execution currently executing this Action
  leaseExpiresAt: Date | null // Lease expiration timestamp for crash recovery (Item 2)
  nextAttemptAt: Date | null // Durable scheduling timestamp for next retry attempt (Item 1 & Item 7)
  externalId: string | null // ID in Jira / Linear / GitHub after export
  createdAt: Date
  updatedAt: Date
}

/**
 * State machine definition for Action status transitions.
 */
export const VALID_ACTION_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  proposed: ['approved'],
  approved: ['queued'],
  queued: ['in-progress'],
  'in-progress': ['completed', 'failed'],
  completed: [],
  failed: [],
}

/**
 * Validates authority transitions (Who/what is allowed to trigger which state change) (Item 5)
 */
export const ACTION_TRANSITION_AUTHORITIES: Partial<
  Record<ActionStatus, Partial<Record<ActionStatus, ActionActor[]>>>
> = {
  proposed: {
    approved: ['user', 'system'],
  },
  approved: {
    queued: ['system'],
  },
  queued: {
    'in-progress': ['executor', 'system', 'recovery'],
  },
  'in-progress': {
    completed: ['executor'],
    failed: ['executor', 'recovery', 'system'],
  },
  completed: {},
  failed: {},
}

/**
 * Validates whether a state transition is allowed according to state-machine and actor authority rules.
 * Throws a domain Error if the transition is illegal.
 */
export function validateActionTransition(
  from: ActionStatus,
  to: ActionStatus,
  actor: ActionActor = 'system'
): void {
  const allowed = VALID_ACTION_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`Invalid action status transition: cannot transition from "${from}" to "${to}"`)
  }

  const allowedActors = ACTION_TRANSITION_AUTHORITIES[from]?.[to]
  if (!allowedActors || !allowedActors.includes(actor)) {
    throw new Error(
      `Transition from "${from}" to "${to}" rejected: actor "${actor}" is not authorized. Authorized actors: [${allowedActors?.join(', ')}]`
    )
  }
}

/**
 * Deterministically generates an Action idempotency key.
 */
export function generateActionIdempotencyKey(
  workspaceId: string,
  recommendationId: string,
  proposedActionId: string
): string {
  if (!workspaceId || workspaceId.trim().length === 0) {
    throw new Error('Workspace ID must be non-empty to generate idempotency key')
  }
  if (!recommendationId || recommendationId.trim().length === 0) {
    throw new Error('Recommendation ID must be non-empty to generate idempotency key')
  }
  if (!proposedActionId || proposedActionId.trim().length === 0) {
    throw new Error('ProposedAction ID must be non-empty to generate idempotency key')
  }
  return `promo:${workspaceId}:${recommendationId}:${proposedActionId}`
}

/**
 * Validates all domain invariants for an Action.
 * Throws a domain Error if any invariant is violated.
 */
export function validateAction(action: Action): void {
  if (!action.id || action.id.trim().length === 0) {
    throw new Error('Action must have a valid non-empty id')
  }
  if (!action.workspaceId || action.workspaceId.trim().length === 0) {
    throw new Error('Action must have a valid non-empty workspaceId')
  }
  if (!action.title || action.title.trim().length === 0) {
    throw new Error('Action must have a non-empty title')
  }
  if (!action.status) {
    throw new Error('Action must have a status')
  }
  if (!action.target) {
    throw new Error('Action must have a target')
  }
  if (!action.relatedRecommendationId || action.relatedRecommendationId.trim().length === 0) {
    throw new Error('Action must be linked to a non-empty relatedRecommendationId')
  }
  if (!action.relatedProposedActionId || action.relatedProposedActionId.trim().length === 0) {
    throw new Error('Action must be linked to a non-empty relatedProposedActionId')
  }

  // IdempotencyKey Invariant check
  if (!action.idempotencyKey || action.idempotencyKey.trim().length === 0) {
    throw new Error('Action must have a valid non-empty idempotencyKey')
  }
  const expectedKey = generateActionIdempotencyKey(
    action.workspaceId,
    action.relatedRecommendationId,
    action.relatedProposedActionId
  )
  if (action.idempotencyKey !== expectedKey) {
    throw new Error(
      `Action idempotencyKey mismatch: expected "${expectedKey}", found "${action.idempotencyKey}"`
    )
  }

  // Target-specific externalId invariant
  if (action.target === 'internal' && action.externalId !== null) {
    throw new Error('Action with target "internal" must have externalId set to null')
  }
}

/**
 * Domain factory to safely construct an Action and enforce structural invariants.
 */
export function createAction(
  data: Omit<Action, 'id' | 'idempotencyKey' | 'claimedByExecutionId' | 'leaseExpiresAt' | 'nextAttemptAt' | 'createdAt' | 'updatedAt'> & {
    id?: string
    idempotencyKey?: string
    claimedByExecutionId?: string | null
    leaseExpiresAt?: Date | null
    nextAttemptAt?: Date | null
    createdAt?: Date
    updatedAt?: Date
  }
): Action {
  // Pre-validate critical provenance fields to yield clean, exact domain exceptions
  if (!data.relatedRecommendationId || data.relatedRecommendationId.trim().length === 0) {
    throw new Error('Action must be linked to a non-empty relatedRecommendationId')
  }
  if (!data.relatedProposedActionId || data.relatedProposedActionId.trim().length === 0) {
    throw new Error('Action must be linked to a non-empty relatedProposedActionId')
  }

  const idempotencyKey =
    data.idempotencyKey ??
    generateActionIdempotencyKey(
      data.workspaceId,
      data.relatedRecommendationId,
      data.relatedProposedActionId
    )

  const action: Action = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    title: data.title,
    description: data.description,
    target: data.target,
    status: data.status,
    relatedRecommendationId: data.relatedRecommendationId,
    relatedProposedActionId: data.relatedProposedActionId,
    idempotencyKey,
    claimedByExecutionId: data.claimedByExecutionId ?? null,
    leaseExpiresAt: data.leaseExpiresAt ?? null,
    nextAttemptAt: data.nextAttemptAt ?? null,
    externalId: data.externalId,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  }

  validateAction(action)
  return action
}

/**
 * Conversion Boundary Factory
 *
 * Recommender → ProposedAction → Action
 *
 * Verifies that the ProposedAction actually belongs to the Recommendation,
 * and maps properties while ensuring strict provenance mapping.
 */
export function createActionFromProposedAction(
  recommendation: Recommendation,
  proposedAction: ProposedAction
): Action {
  // Validate input structures (reject malformed inputs)
  if (!recommendation || typeof recommendation !== 'object') {
    throw new Error('Recommendation must be a valid object')
  }
  if (!recommendation.id || recommendation.id.trim().length === 0) {
    throw new Error('Recommendation must have a valid non-empty id')
  }
  if (!recommendation.workspaceId || recommendation.workspaceId.trim().length === 0) {
    throw new Error('Recommendation must have a valid non-empty workspaceId')
  }

  if (!proposedAction || typeof proposedAction !== 'object') {
    throw new Error('ProposedAction must be a valid object')
  }
  if (!proposedAction.id || proposedAction.id.trim().length === 0) {
    throw new Error('ProposedAction must have a valid non-empty id')
  }
  if (!proposedAction.title || proposedAction.title.trim().length === 0) {
    throw new Error('ProposedAction must have a non-empty title')
  }

  // Validate that the ProposedAction actually belongs to this Recommendation
  const hasAction = recommendation.proposedActions?.some((pa) => pa.id === proposedAction.id)
  if (!hasAction) {
    throw new Error(
      `ProposedAction "${proposedAction.id}" does not belong to Recommendation "${recommendation.id}"`
    )
  }

  return createAction({
    workspaceId: recommendation.workspaceId,
    title: proposedAction.title,
    description: proposedAction.description,
    target: 'internal', // Default to internal (export targets handled outside)
    status: 'proposed', // Initialize status as proposed
    relatedRecommendationId: recommendation.id,
    relatedProposedActionId: proposedAction.id,
    externalId: null, // Starts as null
  })
}

/**
 * State Transition Runner
 *
 * Validates and executes a state transition on an Action, returning an updated
 * copy with an updated status and updatedAt timestamp. This maintains an
 * immutable domain model.
 */
export function transitionAction(
  action: Action,
  nextStatus: ActionStatus,
  actor: ActionActor = 'system'
): Action {
  // Validate that nextStatus is a known valid ActionStatus
  const validStatuses = Object.keys(VALID_ACTION_TRANSITIONS) as ActionStatus[]
  if (!validStatuses.includes(nextStatus)) {
    throw new Error(`Unknown action status: "${nextStatus}"`)
  }

  // Validate state-machine and actor authority rules
  validateActionTransition(action.status, nextStatus, actor)

  // Return a new Action object preserving all other fields exactly as they were
  return {
    ...action,
    status: nextStatus,
    updatedAt: new Date(),
  }
}
