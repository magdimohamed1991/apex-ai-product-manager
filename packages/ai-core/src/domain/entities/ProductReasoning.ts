export interface AIAlternative {
  label: string
  effort: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

export type ReasoningFailureReason =
  'provider_error' | 'invalid_json' | 'schema_violation' | 'grounding_violation'

export interface AIProductReasoning {
  recommendationId: string
  workspaceId: string
  /** Owning project; required for newly persisted project-derived artifacts. */
  projectId?: string
  model: string
  version: string
  contextHash: string
  rationale: string
  impactExplanation: string
  tradeoffs: string[]
  alternatives: AIAlternative[]
  knowns: string[]
  inferences: string[]
  unknowns: string[]
  clarifyingQuestions: string[]
  confidence: number
  recommendedDecision: string
  timestamp: Date
  /**
   * When true, the LLM response was invalid/unavailable and the record was
   * produced by the deterministic fallback. The PMs must be told this
   * explicitly. Defaults to false.
   */
  unavailable?: boolean
  /**
   * If `unavailable` is true, the specific reason the reasoning was rejected.
   */
  failureReason?: ReasoningFailureReason
}
