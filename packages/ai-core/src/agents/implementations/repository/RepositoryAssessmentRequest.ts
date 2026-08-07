import type { Workspace, Insight, Finding, Recommendation, Explanation } from '../../../domain'
import type { RepositorySummary, Evidence } from '@apex/analysis'

/**
 * Input to the Repository Intelligence Agent.
 * Pre-processed data — the agent never receives raw files.
 * Evidence is included so the LLM receives structured facts, not raw code.
 */
export interface RepositoryAssessmentRequest {
  workspace: Workspace
  repository: RepositorySummary
  evidence: Evidence[]
  insights: Insight[]
  findings: Finding[]
  recommendations: Recommendation[]
  explanations: Explanation[]
}
