/**
 * Standardized result returned by every agent.
 * Agents never throw — they return a result with success/error.
 */
export interface AgentResult<T> {
  success: boolean
  data?: T
  error?: Error
  durationMs: number
  agentId: string
  agentVersion: string
}

export function successResult<T>(
  agentId: string,
  agentVersion: string,
  data: T,
  durationMs: number
): AgentResult<T> {
  return { success: true, data, durationMs, agentId, agentVersion }
}

export function errorResult<T>(
  agentId: string,
  agentVersion: string,
  error: Error,
  durationMs: number
): AgentResult<T> {
  return { success: false, error, durationMs, agentId, agentVersion }
}
