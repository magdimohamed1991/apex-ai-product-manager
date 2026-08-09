import type { Action } from '../../../domain/entities'
import type { ActionTargetAdapter, AdapterContext, AdapterExecutionResult } from '../ActionApplicationService'

/**
 * Mock Simulation Client for Slack API.
 */
export class SlackAdapter implements ActionTargetAdapter {
  readonly target = 'slack' as const

  static readonly mockExternalMessages = new Map<string, string>()

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: Slack bot token is missing or invalid')
    }
    if (!action.title || action.title.trim().length === 0) {
      throw new Error('400 Bad Request: Slack message must have a title')
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

    const existingId = SlackAdapter.mockExternalMessages.get(idempotencyKey)
    if (existingId) {
      return {
        externalId: existingId,
        resolution: 'existing',
        metadata: { info: `Reconciled: recovered existing Slack Message ${existingId}` },
      }
    }

    const newMessageId = `slack-msg-${Math.floor(Math.random() * 100000)}`
    SlackAdapter.mockExternalMessages.set(idempotencyKey, newMessageId)

    return {
      externalId: newMessageId,
      resolution: 'created',
      metadata: { info: `Posted Slack Message ${newMessageId}` },
    }
  }
}
