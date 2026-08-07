import type { Workspace, Insight, Finding, Recommendation, Explanation } from '../../../domain'
import type { RepositorySummary } from '@apex/analysis'

/**
 * Input to the Repository Intelligence Agent.
 * Pre-processed data — the agent never receives raw files.
 */
export interface RepositoryAssessmentRequest {
  workspace: Workspace
  repository: RepositorySummary
  insights: Insight[]
  findings: Finding[]
  recommendations: Recommendation[]
  explanations: Explanation[]
}
