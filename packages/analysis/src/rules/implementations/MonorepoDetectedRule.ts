import type { Evidence } from '../../evidence'
import type { Rule, RuleResult } from '../Rule'

export class MonorepoDetectedRule implements Rule {
  readonly id = 'monorepo-detected'
  readonly name = 'Monorepo Architecture'

  evaluate(evidence: Evidence[]): RuleResult {
    const e = evidence.find((e) => e.key === 'hasMonorepo')
    const matched = e?.value === true

    return {
      ruleId: this.id,
      matched,
      severity: 'info',
      priority: 'low',
      title: 'Monorepo architecture detected',
      message:
        'The project uses a monorepo structure, enabling shared packages and atomic cross-cutting changes.',
      evidenceIds: e ? [e.id] : [],
    }
  }
}
