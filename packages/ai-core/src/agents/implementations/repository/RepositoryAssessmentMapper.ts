import type { RepositoryAssessment } from '@apex/contracts'
import type { WorkspaceId } from '../../../domain'

/**
 * Final domain object produced by the Repository Intelligence Agent.
 * This is what the UI and downstream agents consume.
 */
export interface RepositoryAssessmentEntity {
  id: string
  workspaceId: WorkspaceId
  executiveSummary: string
  strengths: string[]
  risks: RepositoryAssessment['risks']
  technicalDebt: RepositoryAssessment['technicalDebt']
  engineeringPriorities: RepositoryAssessment['engineeringPriorities']
  confidence: number
  provider: string
  model: string
  promptVersion: string
  tokenUsage: { prompt: number; completion: number; total: number }
  generatedAt: Date
}

/**
 * Maps validated LLM output to a domain entity.
 * The domain never receives raw LLM responses.
 */
export class RepositoryAssessmentMapper {
  toDomain(
    assessment: RepositoryAssessment,
    workspaceId: WorkspaceId,
    meta: {
      provider: string
      model: string
      promptVersion: string
      tokenUsage: { prompt: number; completion: number; total: number }
    }
  ): RepositoryAssessmentEntity {
    return {
      id: crypto.randomUUID(),
      workspaceId,
      executiveSummary: assessment.executiveSummary,
      strengths: assessment.strengths,
      risks: assessment.risks,
      technicalDebt: assessment.technicalDebt,
      engineeringPriorities: assessment.engineeringPriorities,
      confidence: assessment.confidence,
      provider: meta.provider,
      model: meta.model,
      promptVersion: meta.promptVersion,
      tokenUsage: meta.tokenUsage,
      generatedAt: new Date(),
    }
  }
}
