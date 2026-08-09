import type { Action } from '../../../domain/entities'
import type {
  ActionTargetAdapter,
  AdapterContext,
  AdapterExecutionResult,
} from '../ActionApplicationService'
import { Logger } from '../../../observability/Logger'

const log = new Logger('adapter.slack')

/**
 * Slack Target Adapter (TEST-ONLY MOCK)
 *
 * Real Slack integration is not yet implemented.
 */
export class SlackAdapter implements ActionTargetAdapter {
  readonly target = 'slack' as const

  static readonly mockExternalMessages = new Map<string, string>()

  private isTestEnvironment(): boolean {
    return process.env.NODE_ENV !== 'production'
  }

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!this.isTestEnvironment()) {
      throw new Error(
        'SlackAdapter is a test-only mock. Real Slack integration is not yet implemented.'
      )
    }
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: Slack bot token is missing')
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
      log.debug('Mock Slack reconciled', { actionId: action.id, externalId: existingId })
      return {
        externalId: existingId,
        resolution: 'existing',
        metadata: { info: `Reconciled: recovered mock Slack Message ${existingId}`, mock: true },
      }
    }
    const newMessageId = `slack-msg-mock-${idempotencyKey.slice(-12)}`
    SlackAdapter.mockExternalMessages.set(idempotencyKey, newMessageId)
    log.info('Mock Slack created (test only)', { actionId: action.id, externalId: newMessageId })
    return {
      externalId: newMessageId,
      resolution: 'created',
      metadata: { info: `Posted mock Slack Message ${newMessageId}`, mock: true },
    }
  }
}
