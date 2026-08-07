import { describe, it, expect } from 'vitest'
import {
  RuleEngine,
  NoTestsRule,
  NoCIRule,
  NoDockerRule,
  MonorepoDetectedRule,
  NoTypeScriptRule,
} from '../index'
import type { Evidence } from '../../evidence'

function makeEvidence(key: string, value: unknown): Evidence {
  return {
    id: `testing:${key}`,
    type: 'testing',
    source: 'github',
    key,
    value,
    confidence: 1,
    collectedAt: new Date(),
  }
}

describe('NoTestsRule', () => {
  const rule = new NoTestsRule()

  it('matches when hasTests is false', () => {
    const result = rule.evaluate([makeEvidence('hasTests', false)])
    expect(result.matched).toBe(true)
  })

  it('does not match when hasTests is true', () => {
    const result = rule.evaluate([makeEvidence('hasTests', true)])
    expect(result.matched).toBe(false)
  })

  it('returns high severity', () => {
    const result = rule.evaluate([makeEvidence('hasTests', false)])
    expect(result.severity).toBe('high')
  })

  it('includes evidence id', () => {
    const e = makeEvidence('hasTests', false)
    const result = rule.evaluate([e])
    expect(result.evidenceIds).toContain(e.id)
  })
})

describe('NoCIRule', () => {
  const rule = new NoCIRule()

  it('matches when hasCI is false', () => {
    const result = rule.evaluate([makeEvidence('hasCI', false)])
    expect(result.matched).toBe(true)
  })

  it('does not match when hasCI is true', () => {
    const result = rule.evaluate([makeEvidence('hasCI', true)])
    expect(result.matched).toBe(false)
  })

  it('returns medium severity', () => {
    const result = rule.evaluate([makeEvidence('hasCI', false)])
    expect(result.severity).toBe('medium')
  })
})

describe('NoDockerRule', () => {
  const rule = new NoDockerRule()

  it('matches when hasDocker is false', () => {
    const result = rule.evaluate([makeEvidence('hasDocker', false)])
    expect(result.matched).toBe(true)
  })

  it('does not match when hasDocker is true', () => {
    const result = rule.evaluate([makeEvidence('hasDocker', true)])
    expect(result.matched).toBe(false)
  })
})

describe('MonorepoDetectedRule', () => {
  const rule = new MonorepoDetectedRule()

  it('matches when hasMonorepo is true', () => {
    const result = rule.evaluate([makeEvidence('hasMonorepo', true)])
    expect(result.matched).toBe(true)
  })

  it('does not match when hasMonorepo is false', () => {
    const result = rule.evaluate([makeEvidence('hasMonorepo', false)])
    expect(result.matched).toBe(false)
  })

  it('returns info severity', () => {
    const result = rule.evaluate([makeEvidence('hasMonorepo', true)])
    expect(result.severity).toBe('info')
  })
})

describe('NoTypeScriptRule', () => {
  const rule = new NoTypeScriptRule()

  it('matches when hasTypeScript is false', () => {
    const result = rule.evaluate([makeEvidence('hasTypeScript', false)])
    expect(result.matched).toBe(true)
  })

  it('does not match when hasTypeScript is true', () => {
    const result = rule.evaluate([makeEvidence('hasTypeScript', true)])
    expect(result.matched).toBe(false)
  })
})

describe('RuleEngine', () => {
  it('returns only matched rules', () => {
    const engine = new RuleEngine().registerMany([new NoTestsRule(), new NoCIRule()])
    const evidence = [makeEvidence('hasTests', false), makeEvidence('hasCI', true)]
    const results = engine.evaluate(evidence)
    expect(results).toHaveLength(1)
    expect(results[0].ruleId).toBe('no-tests')
  })

  it('returns all rules with evaluateAll', () => {
    const engine = new RuleEngine().registerMany([new NoTestsRule(), new NoCIRule()])
    const evidence = [makeEvidence('hasTests', false), makeEvidence('hasCI', true)]
    const results = engine.evaluateAll(evidence)
    expect(results).toHaveLength(2)
  })

  it('returns count of registered rules', () => {
    const engine = new RuleEngine().registerMany([
      new NoTestsRule(),
      new NoCIRule(),
      new NoDockerRule(),
    ])
    expect(engine.count).toBe(3)
  })
})
