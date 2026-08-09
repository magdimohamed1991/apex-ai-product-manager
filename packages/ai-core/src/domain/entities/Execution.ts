import type { WorkspaceId } from '../value-objects'

export type ExecutionStatus = 'pending' | 'in-progress' | 'completed' | 'failed'

export type ExecutionFailureClass =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'external_conflict'
  | 'not_found'
  | 'provider_error'
  | 'unknown'

export interface ExecutionError {
  code: ExecutionFailureClass
  message: string
  retryable: boolean
  retryAfterMs?: number
  timestamp: Date
}

/**
 * Concrete retry/backoff policy definition (Item 4).
 */
export interface RetryPolicy {
  maxAttempts: number
  initialBackoffMs: number
  backoffMultiplier: number
  maxBackoffMs: number
}

/**
 * Global default retry configurations.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 30000,
}

/**
 * Deterministically calculates exponential backoff delay in milliseconds (Item 4).
 */
export function calculateBackoffDelay(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  if (attempt < 1) return 0
  const delay = policy.initialBackoffMs * Math.pow(policy.backoffMultiplier, attempt - 1)
  return Math.min(delay, policy.maxBackoffMs)
}

/**
 * An Execution represents ONE specific attempt to perform an Action.
 *
 * Immutably tracks execution outcomes, external IDs, and retry attempts
 * separately from the Action itself to preserve terminal status rules.
 */
export interface Execution {
  id: string
  actionId: string
  workspaceId: WorkspaceId
  attempt: number
  status: ExecutionStatus
  idempotencyKey: string // format: `exec:${actionId}:${attempt}`
  externalId: string | null
  error: ExecutionError | null
  startedAt: Date
  completedAt: Date | null
}

/**
 * Validates the Execution entity invariants.
 */
export function validateExecution(exec: Execution): void {
  if (!exec.id || exec.id.trim().length === 0) {
    throw new Error('Execution must have a valid non-empty id')
  }
  if (!exec.actionId || exec.actionId.trim().length === 0) {
    throw new Error('Execution must be linked to a valid non-empty actionId')
  }
  if (!exec.workspaceId || exec.workspaceId.trim().length === 0) {
    throw new Error('Execution must have a valid non-empty workspaceId')
  }
  if (exec.attempt < 1) {
    throw new Error('Execution attempt number must be greater than or equal to 1')
  }
  const expectedKey = `exec:${exec.actionId}:${exec.attempt}`
  if (exec.idempotencyKey !== expectedKey) {
    throw new Error(`Execution idempotencyKey mismatch: expected "${expectedKey}", found "${exec.idempotencyKey}"`)
  }
}

/**
 * Domain factory to safely construct an Execution attempt.
 */
export function createExecution(
  data: Omit<Execution, 'id' | 'idempotencyKey' | 'startedAt' | 'completedAt'> & {
    id?: string
    idempotencyKey?: string
    startedAt?: Date
    completedAt?: Date | null
  }
): Execution {
  const id = data.id ?? crypto.randomUUID()
  const idempotencyKey = data.idempotencyKey ?? `exec:${data.actionId}:${data.attempt}`

  const exec: Execution = {
    id,
    actionId: data.actionId,
    workspaceId: data.workspaceId,
    attempt: data.attempt,
    status: data.status,
    idempotencyKey,
    externalId: data.externalId,
    error: data.error,
    startedAt: data.startedAt ?? new Date(),
    completedAt: data.completedAt ?? null,
  }

  validateExecution(exec)
  return exec
}
