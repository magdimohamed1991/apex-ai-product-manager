export interface AIAlternative {
  label: string
  effort: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

export interface AIProductReasoning {
  recommendationId: string
  workspaceId: string
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
}
