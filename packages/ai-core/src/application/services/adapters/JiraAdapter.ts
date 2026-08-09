import type { Action } from '../../../domain/entities'
import type {
  ActionTargetAdapter,
  AdapterContext,
  AdapterExecutionResult,
} from '../ActionApplicationService'
import { Logger } from '../../../observability/Logger'

const log = new Logger('adapter.jira')

/**
 * Jira Target Adapter (TEST-ONLY MOCK)
 *
 * This adapter is intentionally a mock implementation. It is registered
 * only inside tests and explicitly cannot be invoked as a real Jira
 * integration in production. Any production code that registers this
 * adapter for the `jira` target will fail authentication against a
 * real Jira instance.
 *
 * Real Jira integration is not yet implemented. See `docs/ROADMAP.md`
 * for status.
 */
export class JiraAdapter implements ActionTargetAdapter {
  readonly target = 'jira' as const

  static readonly mockExternalIssues = new Map<string, string>()

  /** Returns true when running in test environment. */
  private isTestEnvironment(): boolean {
    return process.env.NODE_ENV !== 'production'
  }

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!this.isTestEnvironment()) {
      throw new Error(
        'JiraAdapter is a test-only mock. Real Jira integration is not yet implemented. ' +
          'Configure the JIRA integration under a real adapter before running in production.'
      )
    }
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: Jira API token is missing')
    }
    if (!action.title || action.title.trim().length === 0) {
      throw new Error('400 Bad Request: Jira issue must have a title')
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
    const existingId = JiraAdapter.mockExternalIssues.get(idempotencyKey)
    if (existingId) {
      log.debug('Mock Jira reconciled', { actionId: action.id, externalId: existingId })
      return {
        externalId: existingId,
        resolution: 'existing',
        metadata: { info: `Reconciled: recovered mock Jira Ticket ${existingId}`, mock: true },
      }
    }
    const newTicketId = `jira-ticket-mock-${idempotencyKey.slice(-12)}`
    JiraAdapter.mockExternalIssues.set(idempotencyKey, newTicketId)
    log.info('Mock Jira created (test only)', { actionId: action.id, externalId: newTicketId })
    return {
      externalId: newTicketId,
      resolution: 'created',
      metadata: { info: `Created mock Jira Ticket ${newTicketId}`, mock: true },
    }
  }
}
