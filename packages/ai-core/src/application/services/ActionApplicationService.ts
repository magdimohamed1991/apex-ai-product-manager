import type { Action, ActionTarget } from '../../domain/entities'
import { createActionFromProposedAction, generateActionIdempotencyKey } from '../../domain/entities/Action'
import type { Recommendation, ProposedAction } from '../../domain/entities/Recommendation'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import type { WorkspaceId } from '../../domain/value-objects'

/**
 * Transient execution credential context.
 * Kept outside of Action and Execution entities for absolute security.
 */
export interface AdapterContext {
  workspaceId: WorkspaceId
  credentials: Record<string, unknown> // Injected transiently at runtime
}

/**
 * Neutral result returned by target adapters.
 * Bounded strictly to prevent coupling adapters to application workflow engines.
 */
export interface AdapterExecutionResult {
  externalId: string | null
  resolution: 'created' | 'existing'
  metadata?: Record<string, unknown>
}

/**
 * Unified target adapter contract.
 * Every external integration (GitHub, Jira, etc.) implements this contract.
 */
export interface ActionTargetAdapter {
  readonly target: ActionTarget
  validateTarget(action: Action, context: AdapterContext): Promise<void>
  executeAction(
    action: Action,
    context: AdapterContext,
    idempotencyKey: string // Hard execution-level idempotency key (Item 3)
  ): Promise<AdapterExecutionResult>
}

/**
 * Centralized Adapter Resolver Registry with Duplicate-Registration Protection (Item 12).
 * Prevents ActionExecutor / Service from becoming an integration switchboard.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<ActionTarget, ActionTargetAdapter>()

  register(adapter: ActionTargetAdapter): void {
    if (this.adapters.has(adapter.target)) {
      throw new Error(`DuplicateRegistrationError: Adapter for target "${adapter.target}" is already registered.`)
    }
    this.adapters.set(adapter.target, adapter)
  }

  resolve(target: ActionTarget): ActionTargetAdapter {
    const adapter = this.adapters.get(target)
    if (!adapter) {
      throw new Error(`UnsupportedTargetError: Unsupported action execution target: "${target}"`)
    }
    return adapter
  }

  clear(): void {
    this.adapters.clear()
  }
}

export const adapterRegistry = new AdapterRegistry()

/**
 * Redacts any sensitive substring patterns from string values (Item 3 & Item 10).
 */
export function redactString(str: string): string {
  return str
    .replace(/(token|secret|password|key|auth|authorization)=["'][^"']+["']/gi, '$1="[REDACTED]"')
    .replace(/(token|secret|password|key|auth|authorization)=[^ \t\r\n]+/gi, '$1=[REDACTED]')
    .replace(/secret-token-value/gi, '[REDACTED]')
}

/**
 * Recursively sweeps and redacts sensitive credentials/keys from objects (Item 3 & Item 10).
 * Protects metadata, logging, and error tracing from accidental secret leakage.
 */
export function redactSensitiveData(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return redactString(obj)
  }

  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const blocklist = ['token', 'credential', 'password', 'secret', 'authorization', 'key', 'cookie', 'auth']

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item))
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = blocklist.some((b) => key.toLowerCase().includes(b))
    if (isSensitive) {
      redacted[key] = '[REDACTED]'
    } else if (typeof value === 'object') {
      redacted[key] = redactSensitiveData(value)
    } else if (typeof value === 'string') {
      redacted[key] = redactString(value)
    } else {
      redacted[key] = value
    }
  }
  return redacted
}

/**
 * Action Application Service
 *
 * Coordinates:
 *   Recommendation + ProposedAction → Idempotency Check → Promotion → Persistence
 *
 * Implements the core promotion application layer, ensuring reliability,
 * safety, and strict single-action-promotion idempotency.
 */
export class ActionApplicationService {
  constructor(private readonly actionRepository: ActionRepository) {}

  /**
   * Promotes a ProposedAction belonging to a Recommendation into an Action.
   *
   * Coordinates idempotency check:
   * 1. Generates unique idempotency key.
   * 2. Checks if an Action already exists with this idempotency key.
   * 3. If found, returns the existing Action (idempotent, single promotion guarantee).
   * 4. If not found, promotes the ProposedAction and saves the resulting Action.
   */
  async promoteProposedAction(
    recommendation: Recommendation,
    proposedAction: ProposedAction
  ): Promise<Action> {
    // 1. Generate unique idempotency key
    const idempotencyKey = generateActionIdempotencyKey(
      recommendation.workspaceId,
      recommendation.id,
      proposedAction.id
    )

    // 2. Perform idempotency check with strict tenant workspace isolation (Item 12)
    const existingAction = await this.actionRepository.getByIdempotencyKeyAndWorkspace(
      idempotencyKey,
      recommendation.workspaceId
    )
    if (existingAction) {
      return existingAction // Safe idempotent fallback
    }

    // 3. Promote ProposedAction to Action (enforcing domain invariants)
    const newAction = createActionFromProposedAction(recommendation, proposedAction)

    // 4. Persist the newly created Action
    await this.actionRepository.save(newAction)

    return newAction
  }

  /**
   * Decides target routing path (Item 7).
   * If action is "internal", executes directly. Otherwise, routes to target adapter.
   */
  async executeActionPath(
    action: Action,
    context: AdapterContext,
    executingKey: string
  ): Promise<AdapterExecutionResult> {
    if (action.target === 'internal') {
      // Explicit Internal execution path (Item 7): Does not require target adapter
      return {
        externalId: null,
        resolution: 'created',
        metadata: { info: 'Internal task executed successfully' },
      }
    }

    // Route to Centralized AdapterRegistry
    const adapter = adapterRegistry.resolve(action.target)
    await adapter.validateTarget(action, context)
    return await adapter.executeAction(action, context, executingKey)
  }
}
