import type { Action } from '../../../domain/entities'
import type {
  ActionTargetAdapter,
  AdapterContext,
  AdapterExecutionResult,
} from '../ActionApplicationService'
import { Logger } from '../../../observability/Logger'

const log = new Logger('adapter.linear')

/**
 * Linear Target Adapter (TEST-ONLY MOCK)
 *
 * Real Linear integration is not yet implemented. Production code must
 * not register this adapter as a real integration target.
 */
export class LinearAdapter implements ActionTargetAdapter {
  readonly target = 'linear' as const

  static readonly mockExternalIssues = new Map<string, string>()

  private isTestEnvironment(): boolean {
    return process.env.NODE_ENV !== 'production'
  }

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!this.isTestEnvironment()) {
      throw new Error(
        'LinearAdapter is a test-only mock. Real Linear integration is not yet implemented.'
      )
    }
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: Linear API key is missing')
    }
    if (!action.title || action.title.trim().length === 0) {
      throw new Error('400 Bad Request: Linear issue must have a title')
    }
  }

  async executeAction(
    action: Action,
    context: AdapterContext,
    idempotencyKey: string
  ): Promise<AdapterExecutionResult> {
    await this.validateTarget(action, context)
    const creds = context.credentials as Record<string, string>
    if (creds.triggerError) {
      throw new Error(creds.triggerError)
    }
    const existingId = LinearAdapter.mockExternalIssues.get(idempotencyKey)
    if (existingId) {
      log.debug('Mock Linear reconciled', { actionId: action.id, externalId: existingId })
      return {
        externalId: existingId,
        resolution: 'existing',
        metadata: { info: `Reconciled: recovered mock Linear Issue ${existingId}`, mock: true },
      }
    }
    const newIssueId = `lin-issue-mock-${idempotencyKey.slice(-12)}`
    LinearAdapter.mockExternalIssues.set(idempotencyKey, newIssueId)
    log.info('Mock Linear created (test only)', { actionId: action.id, externalId: newIssueId })
    return {
      externalId: newIssueId,
      resolution: 'created',
      metadata: { info: `Created mock Linear Issue ${newIssueId}`, mock: true },
    }
  }
}
