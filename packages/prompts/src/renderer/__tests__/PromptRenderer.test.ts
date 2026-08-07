import { describe, it, expect } from 'vitest'
import { PromptRenderer } from '../PromptRenderer'
import type { RepositoryPromptVariables } from '../../variables/repository'
import type { InsightDTO } from '@apex/contracts'

const mockVariables: RepositoryPromptVariables = {
  summary: {
    name: 'my-app',
    owner: 'acme',
    url: 'https://github.com/acme/my-app',
    languages: ['TypeScript'],
    frameworks: ['React', 'Vite'],
    packageManager: 'pnpm',
    hasDocker: false,
    hasCI: true,
    hasTests: false,
    hasMonorepo: true,
    hasTypeScript: true,
    hasTailwind: true,
    complexity: 'medium',
    score: 65,
  },
  evidence: [
    {
      id: 'testing:hasTests',
      type: 'testing',
      source: 'github',
      key: 'hasTests',
      value: false,
      confidence: 1,
      collectedAt: new Date(),
    },
  ],
  insights: [
    {
      id: 'insight-001',
      title: 'No automated tests detected',
      description: 'No Jest or Vitest configuration found.',
      confidence: 1,
      severity: 'high',
      source: 'github',
      evidence: ['testing:hasTests'],
      tags: ['rule-based', 'no-tests'],
      createdAt: new Date(),
    } as InsightDTO,
  ],
}

describe('PromptRenderer', () => {
  const renderer = new PromptRenderer()

  it('renders a non-empty prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content.length).toBeGreaterThan(100)
  })

  it('includes repository name in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('my-app')
  })

  it('includes insight title in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('No automated tests detected')
  })

  it('includes evidence in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('hasTests')
  })

  it('instructs LLM to return JSON not Markdown', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('JSON')
  })

  it('includes JSON schema in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('executiveSummary')
    expect(rendered.content).toContain('engineeringPriorities')
  })

  it('assigns correct version', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables, 'v2')
    expect(rendered.version).toBe('v2')
  })

  it('sets renderedAt timestamp', () => {
    const before = new Date()
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    const after = new Date()
    expect(rendered.renderedAt >= before).toBe(true)
    expect(rendered.renderedAt <= after).toBe(true)
  })
})
