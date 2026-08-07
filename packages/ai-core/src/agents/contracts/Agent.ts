import type { AgentContext } from './AgentContext'
import type { AgentResult } from './AgentResult'

/**
 * Core Agent contract.
 * Every agent in APEX must implement this interface.
 *
 * TInput  — what the agent receives
 * TOutput — what the agent produces (domain entities, not raw data)
 */
export interface Agent<TInput, TOutput> {
  readonly id: string
  readonly name: string
  readonly version: string

  execute(input: TInput, context: AgentContext): Promise<AgentResult<TOutput>>
}
