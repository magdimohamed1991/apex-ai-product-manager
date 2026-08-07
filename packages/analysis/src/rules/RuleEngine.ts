import type { Evidence } from '../evidence'
import type { Rule, RuleResult } from './Rule'

/**
 * Evaluates all registered rules against a set of evidence.
 * Returns only matched rules by default.
 */
export class RuleEngine {
  private readonly rules: Rule[] = []

  register(rule: Rule): this {
    this.rules.push(rule)
    return this
  }

  registerMany(rules: Rule[]): this {
    rules.forEach((r) => this.register(r))
    return this
  }

  evaluate(evidence: Evidence[]): RuleResult[] {
    return this.rules.map((rule) => rule.evaluate(evidence)).filter((result) => result.matched)
  }

  evaluateAll(evidence: Evidence[]): RuleResult[] {
    return this.rules.map((rule) => rule.evaluate(evidence))
  }

  get count(): number {
    return this.rules.length
  }
}
