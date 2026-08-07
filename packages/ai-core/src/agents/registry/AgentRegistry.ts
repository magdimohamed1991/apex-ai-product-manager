import type { Agent, AgentContext, AgentResult } from '../contracts'

/**
 * Central registry for all APEX agents.
 * Supports registration, resolution, and dynamic execution.
 */
export class AgentRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly agents = new Map<string, Agent<any, any>>()

  register<TInput, TOutput>(agent: Agent<TInput, TOutput>): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`)
    }
    this.agents.set(agent.id, agent)
  }

  resolve<TInput, TOutput>(id: string): Agent<TInput, TOutput> {
    const agent = this.agents.get(id)
    if (!agent) {
      throw new Error(`Agent "${id}" not found in registry`)
    }
    return agent as Agent<TInput, TOutput>
  }

  async execute<TInput, TOutput>(
    id: string,
    input: TInput,
    context: AgentContext
  ): Promise<AgentResult<TOutput>> {
    const agent = this.resolve<TInput, TOutput>(id)
    return agent.execute(input, context)
  }

  list(): string[] {
    return Array.from(this.agents.keys())
  }

  has(id: string): boolean {
    return this.agents.has(id)
  }
}

// Singleton registry — shared across the application
export const agentRegistry = new AgentRegistry()
