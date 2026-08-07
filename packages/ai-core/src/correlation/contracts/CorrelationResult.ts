import type { CorrelationCandidate } from './CorrelationCandidate'

/**
 * Output of the Correlation Engine.
 * Contains ranked candidates — not Findings.
 * A downstream process converts candidates to Findings after validation.
 */
export interface CorrelationResult {
  candidates: CorrelationCandidate[]
  evaluatedEvidenceCount: number
  rulesEvaluated: number
  generatedAt: Date
}
