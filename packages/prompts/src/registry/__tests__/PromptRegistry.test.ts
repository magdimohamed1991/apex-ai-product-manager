import { describe, it, expect } from 'vitest'
import { PromptRegistry } from '../PromptRegistry'
import type { RepositoryPromptVariables } from '../../variables/repository'
import type { InsightDTO } from '@apex/contracts'

const mockVars: RepositoryPromptVariables = {
  summary: {
    name: 'test-app',
    owner: 'org',
    url: 'https://github.com/org/test-app',
    languages: ['TypeScript'],
    frameworks: ['React'],
    packageManager: 'pnpm',
    hasDocker: false,
    hasCI: false,
    hasTests: false,
    hasMonorepo: false,
    hasTypeScript: true,
    hasTailwind: false,
    complexity: 'low',
    score: 40,
  },
  evidence: [],
  insights: [] as InsightDTO[],
  findings: [],
  recommendations: [],
  explanations: [],
}

describe('PromptRegistry', () => {
  const registry = new PromptRegistry()

  it('resolves repository-intelligence prompt', () => {
    const rendered = registry.get('repository-intelligence', mockVars)
    expect(rendered).toBeDefined()
    expect(rendered.content.length).toBeGreaterThan(0)
  })

  it('lists all registered prompts', () => {
    const list = registry.list()
    expect(list.length).toBeGreaterThan(0)
    expect(list.map((p) => p.id)).toContain('repository-intelligence')
  })

  it('returns versions for a prompt', () => {
    const versions = registry.versions('repository-intelligence')
    expect(versions).toContain('v1')
  })

  it('uses latest version by default', () => {
    const rendered = registry.get('repository-intelligence', mockVars)
    expect(rendered.version).toBe('v1')
  })

  it('respects explicit version', () => {
    const rendered = registry.get('repository-intelligence', mockVars, 'v1')
    expect(rendered.version).toBe('v1')
  })

  it('throws for unsupported version', () => {
    expect(() => registry.get('repository-intelligence', mockVars, 'v999')).toThrow(
      'does not have version "v999"'
    )
  })

  it('throws for unknown prompt id', () => {
    expect(() =>
      // @ts-expect-error — testing unknown id
      registry.get('unknown-prompt', mockVars)
    ).toThrow()
  })
})
