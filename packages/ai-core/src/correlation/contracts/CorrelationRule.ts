import type { Evidence } from '@apex/analysis'
import type { CorrelationCandidate } from './CorrelationCandidate'

/**
 * A CorrelationRule evaluates Evidence and returns zero or more candidates.
 * Rules are stateless, deterministic, and independently testable.
 * No LLM, no ML — pure signal detection logic.
 */
export interface CorrelationRule {
  readonly id: string
  readonly name: string
  evaluate(evidence: Evidence[]): CorrelationCandidate[]
}
