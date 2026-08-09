import type { Action } from '../../../domain/entities'
import type { ActionTargetAdapter, AdapterContext, AdapterExecutionResult } from '../ActionApplicationService'

/**
 * Mock Simulation Client for Linear API.
 */
export class LinearAdapter implements ActionTargetAdapter {
  readonly target = 'linear' as const

  static readonly mockExternalIssues = new Map<string, string>()

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: Linear API key is missing or invalid')
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
      return {
        externalId: existingId,
        resolution: 'existing',
        metadata: { info: `Reconciled: recovered existing Linear Issue ${existingId}` },
      }
    }

    const newIssueId = `lin-issue-${Math.floor(Math.random() * 100000)}`
    LinearAdapter.mockExternalIssues.set(idempotencyKey, newIssueId)

    return {
      externalId: newIssueId,
      resolution: 'created',
      metadata: { info: `Created Linear Issue ${newIssueId}` },
    }
  }
}
