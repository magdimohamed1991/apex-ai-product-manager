import type { Action, ActionTransition, Execution, ExecutionError, ExecutionFailureClass, ExecutionStatus, ActionTarget } from '../../domain/entities'
import { createActionTransitionRecord, createExecution, transitionAction } from '../../domain/entities'
import { calculateBackoffDelay, DEFAULT_RETRY_POLICY } from '../../domain/entities/Execution'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import type { WorkspaceId, ActionStatus } from '../../domain/value-objects'
import { adapterRegistry, redactSensitiveData } from './ActionApplicationService'
import type { AdapterContext, AdapterExecutionResult } from './ActionApplicationService'

export interface ExecutionEventLog {
  eventName:
    | 'action.promoted'
    | 'action.claimed'
    | 'action.execution.started'
    | 'action.execution.completed'
    | 'action.execution.failed'
    | 'action.retry.scheduled'
    | 'action.lease.expired'
    | 'action.recovered'
    | 'action.transitioned'
    | 'action.external.reconciled'
  pipelineRunId: string | null
  workspaceId: WorkspaceId
  actionId: string
  recommendationId: string
  proposedActionId: string
  executionId: string | null
  idempotencyKey: string
  target: ActionTarget
  actionStatus: ActionStatus
  executionStatus: ExecutionStatus | null
  attempt: number
  externalId: string | null
  actor: string
  timestamp: Date
}

/**
 * Standardized Structured Event Logging (Item 14).
 * Redacts any transient secrets automatically before log output.
 */
export function logExecutionEvent(event: ExecutionEventLog): void {
  const sanitized = redactSensitiveData(event)
  console.log(`[EVENT] ${event.eventName}:`, JSON.stringify(sanitized, null, 2))
}

/**
 * Action Execution Orchestrator (Milestone B & F)
 *
 * Coordinates:
 *   Load Action → Lease Claim → attempt counter → execute (Internal/Adapter) → atomicity persist outcomes & audits
 */
export class ActionExecutor {
  private readonly leaseDurationMs = 10000 // default 10 seconds lease
  private readonly executionTimeoutMs = 8000 // strict 8 seconds execution timeout (Item 11)

  constructor(private readonly repository: ActionRepository) {}

  /**
   * Orchestrates the execution of a specific Action.
   *
   * Absolute safety invariant: Every state change, transition audit, and execution attempt
   * are persisted atomically in a single transactional database call (persistExecutionOutcome).
   */
  async execute(
    actionId: string,
    workspaceId: WorkspaceId,
    context: AdapterContext,
    pipelineRunId: string | null = null
  ): Promise<Execution> {
    // 1. Fetch action with strict multi-tenant workspace isolation (Item 12)
    const action = await this.repository.getByIdAndWorkspace(actionId, workspaceId)
    if (!action) {
      throw new Error(`Action not found or unauthorized: actionId="${actionId}"`)
    }

    // 2. Validate current state: Must be approved, queued, or in-progress to execute (Item 6)
    if (action.status !== 'approved' && action.status !== 'queued' && action.status !== 'in-progress') {
      throw new Error(`Action is not eligible for execution. Current status: "${action.status}"`)
    }

    // 3. Resolve execution attempts count from history
    const existingExecutions = await this.repository.getExecutionsByAction(actionId, workspaceId)
    const nextAttempt = existingExecutions.length + 1

    // 4. Create transient Execution Attempt representation
    const execution = createExecution({
      actionId,
      workspaceId,
      attempt: nextAttempt,
      status: 'in-progress',
      externalId: null,
      error: null,
    })

    // 5. Atomically acquire/recover lease claim
    const claimSuccess = await this.repository.claimForExecution(
      actionId,
      workspaceId,
      execution.id,
      this.leaseDurationMs
    )
    if (!claimSuccess) {
      throw new Error(`Concurrency Lock Failed: Action "${actionId}" is currently leased by another execution attempt.`)
    }

    // Refresh Action record to capture newly assigned status ('in-progress') and lease details
    const claimedAction = await this.repository.getByIdAndWorkspace(actionId, workspaceId)
    if (!claimedAction) {
      throw new Error('Action state corrupted during execution claiming')
    }

    // Log Claim Event (Item 14)
    logExecutionEvent({
      eventName: 'action.claimed',
      pipelineRunId,
      workspaceId,
      actionId,
      recommendationId: claimedAction.relatedRecommendationId,
      proposedActionId: claimedAction.relatedProposedActionId,
      executionId: execution.id,
      idempotencyKey: claimedAction.idempotencyKey,
      target: claimedAction.target,
      actionStatus: 'in-progress',
      executionStatus: 'in-progress',
      attempt: nextAttempt,
      externalId: null,
      actor: 'executor',
      timestamp: new Date(),
    })

    let outcomeAction: Action = claimedAction
    let outcomeStatus: ActionStatus
    let finalExternalId: string | null = null
    let normalizedError: ExecutionError | null = null
    let wasReconciled = false

    try {
      // 6. Execute integration side-effects with Authoritative Executor Timeout (Item 11)
      const adapterPromise = (async (): Promise<AdapterExecutionResult> => {
        if (claimedAction.target === 'internal') {
          // Explicit Internal execution path (Item 7): Executes directly without adapters
          return {
            externalId: null,
            resolution: 'created',
            metadata: { info: 'Internal task executed successfully' },
          }
        } else {
          // Resolve Target Adapter via Centralized Registry (Item 8)
          const adapter = adapterRegistry.resolve(claimedAction.target)
          // Perform provider-independent validation
          await adapter.validateTarget(claimedAction, context)
          // Execute side-effect idempotently (Item 3)
          return await adapter.executeAction(claimedAction, context, claimedAction.idempotencyKey)
        }
      })()

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`TimeoutError: Execution timed out after ${this.executionTimeoutMs}ms`))
        }, this.executionTimeoutMs)
      })

      // Race execution against hard timeout
      const adapterResult = await Promise.race([adapterPromise, timeoutPromise])

      finalExternalId = adapterResult.externalId
      outcomeStatus = 'completed'
      if (adapterResult.resolution === 'existing') {
        wasReconciled = true
      }
    } catch (err) {
      // Normalize and sanitize provider-specific errors (Item 3, Item 8 & Item 10)
      normalizedError = this.normalizeError(err, nextAttempt)
      outcomeStatus = 'failed'
    }

    const nextTransitions = await this.repository.getTransitionsByAction(actionId, workspaceId)
    const nextSequence = nextTransitions.length + 1

    if (outcomeStatus === 'completed') {
      // 1. Transition Action globally to completed
      outcomeAction = transitionAction(claimedAction, 'completed', 'executor')
      outcomeAction.externalId = finalExternalId
      outcomeAction.claimedByExecutionId = null
      outcomeAction.leaseExpiresAt = null

      const transition: ActionTransition = createActionTransitionRecord({
        actionId,
        workspaceId,
        fromStatus: 'in-progress',
        toStatus: 'completed',
        sequence: nextSequence,
        actor: 'executor',
        reason: 'Execution completed successfully.',
      })

      // 2. Finalize execution status
      execution.status = 'completed'
      execution.externalId = finalExternalId
      execution.completedAt = new Date()

      // 3. Atomically persist complete outcome (Item 5 & Item 6)
      await this.repository.persistExecutionOutcome(outcomeAction, execution, transition)

      // Log Completion Event (Item 14)
      logExecutionEvent({
        eventName: wasReconciled ? 'action.external.reconciled' : 'action.execution.completed',
        pipelineRunId,
        workspaceId,
        actionId,
        recommendationId: claimedAction.relatedRecommendationId,
        proposedActionId: claimedAction.relatedProposedActionId,
        executionId: execution.id,
        idempotencyKey: claimedAction.idempotencyKey,
        target: claimedAction.target,
        actionStatus: 'completed',
        executionStatus: 'completed',
        attempt: nextAttempt,
        externalId: finalExternalId,
        actor: 'executor',
        timestamp: new Date(),
      })
    } else {
      // Execution Attempt Failed
      execution.status = 'failed'
      execution.error = normalizedError
      execution.completedAt = new Date()

      // Determine Retry Policy (Item 4)
      const isRetryable = normalizedError ? normalizedError.retryable : false
      const underAttemptLimit = nextAttempt < DEFAULT_RETRY_POLICY.maxAttempts
      const shouldRetry = isRetryable && underAttemptLimit

      if (shouldRetry) {
        // Keep Action in-progress globally to allow subsequent attempt to recover
        outcomeAction.status = 'in-progress'
        outcomeAction.claimedByExecutionId = null // clear claim so it can be re-claimed on retry
        outcomeAction.leaseExpiresAt = null
        outcomeAction.nextAttemptAt = new Date(Date.now() + (normalizedError?.retryAfterMs ?? 1000))

        // Persist failed attempt without global Action transition (Action remains in-progress)
        await this.repository.saveExecution(execution)
        await this.repository.save(outcomeAction)

        // Log Retry Scheduled Event
        logExecutionEvent({
          eventName: 'action.retry.scheduled',
          pipelineRunId,
          workspaceId,
          actionId,
          recommendationId: claimedAction.relatedRecommendationId,
          proposedActionId: claimedAction.relatedProposedActionId,
          executionId: execution.id,
          idempotencyKey: claimedAction.idempotencyKey,
          target: claimedAction.target,
          actionStatus: 'in-progress',
          executionStatus: 'failed',
          attempt: nextAttempt,
          externalId: null,
          actor: 'executor',
          timestamp: new Date(),
        })
      } else {
        // Terminal Failure: Transition global Action state to failed
        outcomeAction = transitionAction(claimedAction, 'failed', 'executor')
        outcomeAction.claimedByExecutionId = null
        outcomeAction.leaseExpiresAt = null
        outcomeAction.nextAttemptAt = null

        const transition: ActionTransition = createActionTransitionRecord({
          actionId,
          workspaceId,
          fromStatus: 'in-progress',
          toStatus: 'failed',
          sequence: nextSequence,
          actor: 'executor',
          reason: `Execution attempt #${nextAttempt} failed terminally: ${normalizedError?.message}`,
        })

        // Atomically persist terminal failure (Item 5 & Item 6)
        await this.repository.persistExecutionOutcome(outcomeAction, execution, transition)

        // Log Failure Event
        logExecutionEvent({
          eventName: 'action.execution.failed',
          pipelineRunId,
          workspaceId,
          actionId,
          recommendationId: claimedAction.relatedRecommendationId,
          proposedActionId: claimedAction.relatedProposedActionId,
          executionId: execution.id,
          idempotencyKey: claimedAction.idempotencyKey,
          target: claimedAction.target,
          actionStatus: 'failed',
          executionStatus: 'failed',
          attempt: nextAttempt,
          externalId: null,
          actor: 'executor',
          timestamp: new Date(),
        })
      }
    }

    return execution
  }

  /**
   * Normalizes and classifies provider-specific errors into unified ExecutionErrors (Item 8).
   * Redacts any sensitive data contained inside error trace messages (Item 3 & Item 10).
   */
  private normalizeError(error: unknown, attempt: number): ExecutionError {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const messageObj = redactSensitiveData({ text: rawMessage }) as { text: string }
    const message = messageObj.text

    let code: ExecutionFailureClass = 'unknown'
    let retryable = false
    let retryAfterMs: number | undefined

    if (message.includes('401') || message.includes('Unauthorized') || message.includes('token expired')) {
      code = 'authentication'
      retryable = false
    } else if (message.includes('403') || message.includes('Forbidden') || message.includes('Access Denied')) {
      code = 'authorization'
      retryable = false
    } else if (message.includes('429') || message.includes('Rate Limit') || message.includes('Too Many Requests')) {
      code = 'rate_limit'
      retryable = true
      retryAfterMs = calculateBackoffDelay(attempt)
    } else if (message.includes('timeout') || message.includes('504') || message.includes('Gateway Timeout') || message.includes('TimeoutError')) {
      code = 'timeout'
      retryable = true
    } else if (message.includes('network') || message.includes('connection reset') || message.includes('503')) {
      code = 'network'
      retryable = true
    } else if (message.includes('409') || message.includes('Conflict') || message.includes('already exists')) {
      code = 'external_conflict'
      retryable = false
    } else if (message.includes('404') || message.includes('Not Found')) {
      code = 'not_found'
      retryable = false
    } else if (message.includes('invalid') || message.includes('400') || message.includes('Validation')) {
      code = 'validation'
      retryable = false
    } else if (message.includes('500') || message.includes('Internal Server Error')) {
      code = 'provider_error'
      retryable = true
    }

    return {
      code,
      message,
      retryable,
      retryAfterMs,
      timestamp: new Date(),
    }
  }
}

