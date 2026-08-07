import type { Agent, AgentContext, AgentResult } from '../contracts'
import { successResult, errorResult } from '../contracts'

/**
 * Base class for all APEX agents.
 * Provides: timing, error handling, logging hooks, and telemetry.
 *
 * Subclasses implement only `run()` — BaseAgent handles the rest.
 */
export abstract class BaseAgent<TInput, TOutput> implements Agent<TInput, TOutput> {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly version: string

  /**
   * Core logic — implemented by each agent.
   * Should never throw — errors are caught by `execute()`.
   */
  protected abstract run(input: TInput, context: AgentContext): Promise<TOutput>

  async execute(input: TInput, context: AgentContext): Promise<AgentResult<TOutput>> {
    const startedAt = Date.now()

    this.onStart(input, context)

    try {
      const data = await this.run(input, context)
      const durationMs = Date.now() - startedAt

      this.onSuccess(data, durationMs)

      return successResult(this.id, this.version, data, durationMs)
    } catch (err) {
      const durationMs = Date.now() - startedAt
      const error = err instanceof Error ? err : new Error(String(err))

      this.onError(error, durationMs)

      return errorResult(this.id, this.version, error, durationMs)
    }
  }

  // Override these in subclasses for custom logging / telemetry
  protected onStart(_input: TInput, _context: AgentContext): void {}
  protected onSuccess(_data: TOutput, _durationMs: number): void {}
  protected onError(_error: Error, _durationMs: number): void {}
}
