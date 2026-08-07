import type { Evidence } from '../../evidence'
import type { Rule, RuleResult } from '../Rule'

export class NoTestsRule implements Rule {
  readonly id = 'no-tests'
  readonly name = 'No Automated Tests'

  evaluate(evidence: Evidence[]): RuleResult {
    const e = evidence.find((e) => e.key === 'hasTests')
    const matched = e?.value === false

    return {
      ruleId: this.id,
      matched,
      severity: 'high',
      priority: 'high',
      title: 'No automated tests detected',
      message:
        'The repository has no Jest or Vitest configuration. Automated testing is essential for safe deployments.',
      evidenceIds: e ? [e.id] : [],
    }
  }
}
