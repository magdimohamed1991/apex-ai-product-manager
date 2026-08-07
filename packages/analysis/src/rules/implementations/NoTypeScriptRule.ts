import type { Evidence } from '../../evidence'
import type { Rule, RuleResult } from '../Rule'

export class NoTypeScriptRule implements Rule {
  readonly id = 'no-typescript'
  readonly name = 'No TypeScript'

  evaluate(evidence: Evidence[]): RuleResult {
    const e = evidence.find((e) => e.key === 'hasTypeScript')
    const matched = e?.value === false

    return {
      ruleId: this.id,
      matched,
      severity: 'medium',
      priority: 'medium',
      title: 'TypeScript not configured',
      message:
        'The project does not use TypeScript. Adding TypeScript reduces runtime errors and improves developer experience.',
      evidenceIds: e ? [e.id] : [],
    }
  }
}
