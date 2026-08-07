import type { Evidence } from '../../evidence'
import type { Rule, RuleResult } from '../Rule'

export class NoCIRule implements Rule {
  readonly id = 'no-ci'
  readonly name = 'No CI Pipeline'

  evaluate(evidence: Evidence[]): RuleResult {
    const e = evidence.find((e) => e.key === 'hasCI')
    const matched = e?.value === false

    return {
      ruleId: this.id,
      matched,
      severity: 'medium',
      priority: 'medium',
      title: 'No CI pipeline found',
      message:
        'Changes are not automatically validated before merging. A CI pipeline prevents regressions.',
      evidenceIds: e ? [e.id] : [],
    }
  }
}
