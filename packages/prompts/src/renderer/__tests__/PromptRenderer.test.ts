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
  findings: [
    {
      id: 'finding-1',
      type: 'risk',
      title: 'Checkout reliability contributing to conversion decline',
      description: 'Cross-source correlation detected.',
      severity: 'high',
      priority: 'high',
      evidenceIds: ['amp-checkout', 'gh-checkout'],
      correlationId: 'cross-source:amplitude-github',
    },
  ],
  recommendations: [
    {
      id: 'rec-1',
      title: 'Investigate checkout flow',
      rationale: 'Correlated signals across sources.',
      impact: 'high',
      effort: 'medium',
      priority: 'high',
      confidence: 0.85,
      origin: 'finding',
      findingIds: ['finding-1'],
      insightIds: [],
    },
  ],
  explanations: [
    {
      id: 'exp-1',
      summary: 'Checkout metric drop correlates with GitHub code changes',
      evidenceIds: ['amp-checkout', 'gh-checkout'],
      appliedRules: ['metric-code-correlation'],
      confidenceReason: 'High confidence from temporal overlap of metric drop and code change',
    },
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

  it('includes explanations in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('Explanations')
    expect(rendered.content).toContain('Checkout metric drop correlates')
    expect(rendered.content).toContain('metric-code-correlation')
  })

  it('renders "No explanations available" when empty', () => {
    const vars = { ...mockVariables, explanations: [] }
    const rendered = renderer.renderRepositoryIntelligence(vars)
    expect(rendered.content).toContain('No explanations available')
  })

  it('includes finding evidence IDs in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('amp-checkout')
    expect(rendered.content).toContain('gh-checkout')
  })

  it('includes finding correlation ID in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('cross-source:amplitude-github')
  })

  it('includes recommendation origin and finding IDs in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('Origin: finding')
    expect(rendered.content).toContain('Findings: finding-1')
  })

  it('includes explanation evidence IDs in prompt', () => {
    const rendered = renderer.renderRepositoryIntelligence(mockVariables)
    expect(rendered.content).toContain('amp-checkout')
    expect(rendered.content).toContain('gh-checkout')
  })
})
