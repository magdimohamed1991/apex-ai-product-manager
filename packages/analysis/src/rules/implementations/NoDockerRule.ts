import type { Evidence } from '../../evidence'
import type { Rule, RuleResult } from '../Rule'

export class NoDockerRule implements Rule {
  readonly id = 'no-docker'
  readonly name = 'No Dockerfile'

  evaluate(evidence: Evidence[]): RuleResult {
    const e = evidence.find((e) => e.key === 'hasDocker')
    const matched = e?.value === false

    return {
      ruleId: this.id,
      matched,
      severity: 'low',
      priority: 'low',
      title: 'No Dockerfile found',
      message:
        'The project may lack a consistent deployment environment. Adding a Dockerfile ensures reproducible builds.',
      evidenceIds: e ? [e.id] : [],
    }
  }
}
