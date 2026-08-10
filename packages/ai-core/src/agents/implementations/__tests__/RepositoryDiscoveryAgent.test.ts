import { describe, it, expect } from 'vitest'
import { RepositoryDiscoveryAgent } from '../RepositoryDiscoveryAgent'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { RepositoryFiles, Evidence } from '@apex/analysis'

const WORKSPACE_ID = createWorkspaceId('ws-agent-test')

const minimalRepo: RepositoryFiles = {
  url: 'https://github.com/acme/app',
  hasDockerfile: false,
  hasPnpmWorkspace: false,
  hasTurboJson: false,
  hasGitHubActions: false,
  hasJestConfig: false,
  hasVitestConfig: false,
  hasTailwindConfig: false,
  hasTypeScriptConfig: false,
  fileList: [],
}

const multiSourceEvidence: Evidence[] = [
  {
    id: 'amp-checkout-drop',
    type: 'metric',
    source: 'amplitude',
    key: 'checkout_conversion_rate',
    value: -0.18,
    confidence: 0.95,
    collectedAt: new Date(),
  },
  {
    id: 'gplay-checkout-complaints',
    type: 'review',
    source: 'google_play',
    key: 'checkout_failures',
    value: 27,
    confidence: 0.9,
    collectedAt: new Date(),
  },
  {
    id: 'gh-checkout-change',
    type: 'code_change',
    source: 'github',
    key: 'src/checkout/checkout.ts',
    value: { files: ['src/checkout/checkout.ts'], changeType: 'modified' },
    confidence: 1,
    collectedAt: new Date(),
  },
]

const mockContext = {
  workspaceId: WORKSPACE_ID,
  correlationId: 'test-correlation-001',
  startedAt: new Date(),
}

describe('RepositoryDiscoveryAgent', () => {
  const agent = new RepositoryDiscoveryAgent()

  it('has correct id', () => {
    expect(agent.id).toBe('repository-discovery')
  })

  it('has version 2.0.0', () => {
    expect(agent.version).toBe('2.0.0')
  })

  it('runs without throwing', async () => {
    const result = await agent.execute(
      { workspaceId: WORKSPACE_ID, projectId: 'proj-agent-test', files: minimalRepo },
      mockContext
    )
    expect(result.success).toBe(true)
  })

  it('returns complete PipelineResult', async () => {
    const result = await agent.execute(
      { workspaceId: WORKSPACE_ID, projectId: 'proj-agent-test', files: minimalRepo },
      mockContext
    )
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data?.summary).toBeDefined()
    expect(result.data?.evidence).toBeDefined()
    expect(result.data?.insights).toBeDefined()
    expect(result.data?.findings).toBeDefined()
    expect(result.data?.explanations).toBeDefined()
    expect(result.data?.recommendations).toBeDefined()
    expect(result.data?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('generates insights from repository analysis', async () => {
    const result = await agent.execute(
      { workspaceId: WORKSPACE_ID, projectId: 'proj-agent-test', files: minimalRepo },
      mockContext
    )
    expect(result.data?.insights.length).toBeGreaterThan(0)
    expect(result.data?.insights.some((i) => i.tags.includes('no-tests'))).toBe(true)
  })

  it('generates insight-origin recommendations', async () => {
    const result = await agent.execute(
      { workspaceId: WORKSPACE_ID, projectId: 'proj-agent-test', files: minimalRepo },
      mockContext
    )
    const insightRecs = result.data?.recommendations.filter((r) => r.origin === 'insight')
    expect(insightRecs?.length).toBeGreaterThan(0)
  })

  it('generates findings when external evidence provided', async () => {
    const result = await agent.execute(
      {
        workspaceId: WORKSPACE_ID,
        projectId: 'proj-agent-test',
        files: minimalRepo,
        externalEvidence: multiSourceEvidence,
      },
      mockContext
    )
    expect(result.data?.findings.length).toBeGreaterThan(0)
    expect(result.data?.recommendations.some((r) => r.origin === 'finding')).toBe(true)
  })

  it('provenance chain intact for finding recommendations', async () => {
    const result = await agent.execute(
      {
        workspaceId: WORKSPACE_ID,
        projectId: 'proj-agent-test',
        files: minimalRepo,
        externalEvidence: multiSourceEvidence,
      },
      mockContext
    )
    const findingRecs = result.data?.recommendations.filter((r) => r.origin === 'finding')
    for (const rec of findingRecs ?? []) {
      expect(rec.findingIds.length).toBeGreaterThan(0)
      expect(rec.insightIds).toEqual([])
      expect(rec.deduplicationKey).toContain('address-finding:finding:')
    }
  })

  it('measures duration', async () => {
    const result = await agent.execute(
      { workspaceId: WORKSPACE_ID, projectId: 'proj-agent-test', files: minimalRepo },
      mockContext
    )
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
