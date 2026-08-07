/**
 * Structured output contract for Repository Intelligence Agent.
 * The LLM must return this shape — never free-form Markdown.
 */
export interface RepositoryAssessment {
  executiveSummary: string
  strengths: string[]
  risks: AssessmentRisk[]
  technicalDebt: TechnicalDebtAssessment
  engineeringPriorities: EngineeringPriority[]
  confidence: number // 0–1
  generatedAt: Date
}

export interface AssessmentRisk {
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  description: string
  recommendedAction: string
}

export interface TechnicalDebtAssessment {
  level: 'low' | 'medium' | 'high' | 'critical'
  reasoning: string
  estimatedEffortDays: number | null
}

export interface EngineeringPriority {
  rank: number
  title: string
  rationale: string
  effort: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high'
}
