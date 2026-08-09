import type { Action } from '../../../domain/entities'
import type { ActionTargetAdapter, AdapterContext, AdapterExecutionResult } from '../ActionApplicationService'

/**
 * Mock Simulation Client for Jira API.
 */
export class JiraAdapter implements ActionTargetAdapter {
  readonly target = 'jira' as const

  static readonly mockExternalIssues = new Map<string, string>()

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: Jira API token is missing or invalid')
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
      return {
        externalId: existingId,
        resolution: 'existing',
        metadata: { info: `Reconciled: recovered existing Jira Ticket ${existingId}` },
      }
    }

    const newTicketId = `jira-ticket-${Math.floor(Math.random() * 100000)}`
    JiraAdapter.mockExternalIssues.set(idempotencyKey, newTicketId)

    return {
      externalId: newTicketId,
      resolution: 'created',
      metadata: { info: `Created Jira Ticket ${newTicketId}` },
    }
  }
}
