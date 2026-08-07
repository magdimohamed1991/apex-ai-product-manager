import type { Evidence } from '../evidence'

export interface RuleResult {
  ruleId: string
  matched: boolean
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  message: string
  evidenceIds: string[]
}

/**
 * A Rule evaluates a set of Evidence and returns a RuleResult.
 * Rules are stateless and independently testable.
 */
export interface Rule {
  readonly id: string
  readonly name: string
  evaluate(evidence: Evidence[]): RuleResult
}
