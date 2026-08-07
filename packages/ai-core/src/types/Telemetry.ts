/**
 * Telemetry records collected per pipeline/agent execution.
 * Used to track performance, cost, and quality over time.
 */
export interface PipelineTelemetry {
  executionId: string
  pipelineId: string
  workspaceId: string
  startedAt: Date
  durationMs: number

  // Analysis metrics
  evidenceCount: number
  ruleHits: number
  insightCount: number
  recommendationCount: number

  // LLM metrics (null when no LLM was used)
  llm: LLMTelemetry | null
}

export interface LLMTelemetry {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
  durationMs: number
}

export interface ConfidenceDistribution {
  high: number // confidence >= 0.9
  medium: number // confidence 0.6–0.89
  low: number // confidence < 0.6
}
