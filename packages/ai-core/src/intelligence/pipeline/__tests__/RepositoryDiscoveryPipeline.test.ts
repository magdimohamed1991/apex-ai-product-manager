import { describe, it, expect } from 'vitest'
import { RepositoryDiscoveryPipeline } from '../RepositoryDiscoveryPipeline'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { RepositoryFiles, Evidence } from '@apex/analysis'

const WORKSPACE_ID = createWorkspaceId('ws-pipeline-test')

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

const wellConfiguredRepo: RepositoryFiles = {
  url: 'https://github.com/acme/app',
  hasDockerfile: true,
  hasPnpmWorkspace: true,
  hasTurboJson: true,
  hasGitHubActions: true,
  hasJestConfig: false,
  hasVitestConfig: true,
  hasTailwindConfig: true,
  hasTypeScriptConfig: true,
  fileList: ['package.json'],
  packageJson: {
    dependencies: { react: '^19.0.0' },
    devDependencies: { typescript: '^6.0.0', vite: '^8.0.0', turbo: '^2.0.0' },
  },
}

describe('RepositoryDiscoveryPipeline (in ai-core)', () => {
  const pipeline = new RepositoryDiscoveryPipeline()

  it('runs without throwing', () => {
    expect(() => pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })).not.toThrow()
  })

  it('produces a summary', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    expect(result.summary.name).toBe('app')
  })

  it('generates insights for missing tests', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    expect(result.insights.some((i) => i.tags.includes('no-tests'))).toBe(true)
  })

  it('produces explanations for insights', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    expect(result.explanations.length).toBeGreaterThanOrEqual(result.insights.length)
  })

  it('each insight has a linked explanationId', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    result.insights.forEach((i) => expect(i.explanationId).toBeDefined())
  })

  it('explanation ids match insight explanationIds', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const ids = new Set(result.explanations.map((e) => e.id))
    result.insights.forEach((i) => expect(ids.has(i.explanationId!)).toBe(true))
  })

  it('well-configured repo has no no-tests insight', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: wellConfiguredRepo })
    expect(result.insights.some((i) => i.tags.includes('no-tests'))).toBe(false)
  })

  it('generates recommendations', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('measures duration', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rejects external evidence with source/sourceReference mismatch', () => {
    const badEvidence: Evidence[] = [
      {
        id: 'bad-1',
        type: 'metric',
        source: 'github',
        key: 'test',
        value: 0,
        confidence: 1,
        collectedAt: new Date(),
        sourceReference: {
          sourceId: 'gp-1',
          sourceType: 'google_play',
          externalId: '123',
          url: 'https://example.com',
          title: 'Bad review',
          capturedAt: new Date(),
        },
      },
    ]
    expect(() =>
      pipeline.run({
        workspaceId: WORKSPACE_ID,
        files: minimalRepo,
        externalEvidence: badEvidence,
      })
    ).toThrow('Evidence provenance mismatch')
  })

  it('produces findings array', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    expect(Array.isArray(result.findings)).toBe(true)
  })
})

describe('Pipeline correlation → finding → recommendation integration', () => {
  const pipeline = new RepositoryDiscoveryPipeline()

  it('insight recommendations have origin insight', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const insightRecs = result.recommendations.filter((r) => r.origin === 'insight')
    expect(insightRecs.length).toBeGreaterThan(0)
    for (const rec of insightRecs) {
      expect(rec.insightIds.length).toBeGreaterThan(0)
      expect(rec.findingIds).toEqual([])
    }
  })

  it('finding recommendations have origin finding when findings exist', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const findingRecs = result.recommendations.filter((r) => r.origin === 'finding')
    for (const rec of findingRecs) {
      expect(rec.findingIds.length).toBeGreaterThan(0)
      expect(rec.insightIds).toEqual([])
    }
  })

  it('findings have correlationId when derived from correlation', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    for (const finding of result.findings) {
      expect(finding.correlationId).toBeDefined()
    }
  })

  it('findings have evidenceIds', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    for (const finding of result.findings) {
      expect(finding.evidenceIds.length).toBeGreaterThan(0)
    }
  })

  it('no finding reaches insight-only strategies', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const findingRecs = result.recommendations.filter((r) => r.origin === 'finding')
    for (const rec of findingRecs) {
      expect(rec.title).not.toContain('Introduce automated testing')
      expect(rec.title).not.toContain('Set up a CI pipeline')
      expect(rec.title).not.toContain('Migrate to TypeScript')
    }
  })

  it('no duplicate recommendations by deduplicationKey', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const keys = result.recommendations.map((r) => r.deduplicationKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('mixed insight and finding recommendations coexist', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const origins = new Set(result.recommendations.map((r) => r.origin))
    expect(origins.has('insight')).toBe(true)
  })

  it('finding explanations are included in pipeline explanations', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const findingExplanations = result.explanations.filter((e) => e.findingIds.length > 0)
    expect(findingExplanations.length).toBe(result.findings.length)
  })

  it('finding explanations have correct findingIds', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const findingExplanations = result.explanations.filter((e) => e.findingIds.length > 0)
    const findingIds = new Set(result.findings.map((f) => f.id))
    for (const explanation of findingExplanations) {
      for (const fid of explanation.findingIds) {
        expect(findingIds.has(fid)).toBe(true)
      }
    }
  })

  it('finding explanations have evidenceIds matching their findings', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const findingExplanations = result.explanations.filter((e) => e.findingIds.length > 0)
    const findingsById = new Map(result.findings.map((f) => [f.id, f]))
    for (const explanation of findingExplanations) {
      const finding = findingsById.get(explanation.findingIds[0])
      expect(finding).toBeDefined()
      expect(explanation.evidenceIds.length).toBeGreaterThan(0)
    }
  })

  it('insight explanations still have insightIds', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const insightExplanations = result.explanations.filter((e) => e.insightIds.length > 0)
    expect(insightExplanations.length).toBe(result.insights.length)
  })
})

describe('Real multi-source evidence → finding → recommendation (end-to-end)', () => {
  const pipeline = new RepositoryDiscoveryPipeline()

  function makeExternalEvidence(): Evidence[] {
    const now = new Date()
    return [
      // Amplitude: negative metric (conversion drop)
      {
        id: 'amp-checkout-drop',
        type: 'metric',
        source: 'amplitude',
        key: 'checkout_conversion_rate',
        value: -0.18, // 18% drop
        confidence: 0.95,
        collectedAt: new Date(now.getTime() - 86400000), // 1 day ago
      },
      // Google Play: negative reviews (complaints about checkout)
      {
        id: 'gplay-checkout-complaints',
        type: 'review',
        source: 'google_play',
        key: 'checkout_failures',
        value: 27, // 27 complaints
        confidence: 0.9,
        collectedAt: new Date(now.getTime() - 43200000), // 12 hours ago
      },
      // GitHub: recent code change in checkout area
      {
        id: 'gh-checkout-change',
        type: 'code_change',
        source: 'github',
        key: 'src/checkout/checkout.ts',
        value: { files: ['src/checkout/checkout.ts'], changeType: 'modified' },
        confidence: 1,
        collectedAt: new Date(now.getTime() - 21600000), // 6 hours ago
      },
    ]
  }

  it('produces findings from multi-source correlation', () => {
    const result = pipeline.run({
      workspaceId: WORKSPACE_ID,
      files: minimalRepo,
      externalEvidence: makeExternalEvidence(),
    })

    expect(result.findings.length).toBeGreaterThan(0)

    for (const finding of result.findings) {
      expect(finding.correlationId).toBeDefined()
      expect(finding.evidenceIds.length).toBeGreaterThan(0)
      expect(finding.description).not.toMatch(/caused|because of|due to/i)
    }
  })

  it('generates finding-origin recommendations from multi-source findings', () => {
    const result = pipeline.run({
      workspaceId: WORKSPACE_ID,
      files: minimalRepo,
      externalEvidence: makeExternalEvidence(),
    })

    const findingRecs = result.recommendations.filter((r) => r.origin === 'finding')
    expect(findingRecs.length).toBeGreaterThan(0)

    for (const rec of findingRecs) {
      expect(rec.findingIds.length).toBeGreaterThan(0)
      expect(rec.insightIds).toEqual([])
      expect(rec.origin).toBe('finding')
      expect(rec.deduplicationKey).toContain('address-finding:finding:')
    }
  })

  it('finding explanations have evidenceIds matching their findings', () => {
    const result = pipeline.run({
      workspaceId: WORKSPACE_ID,
      files: minimalRepo,
      externalEvidence: makeExternalEvidence(),
    })

    const findingExplanations = result.explanations.filter((e) => e.findingIds.length > 0)
    const findingsById = new Map(result.findings.map((f) => [f.id, f]))

    for (const explanation of findingExplanations) {
      const finding = findingsById.get(explanation.findingIds[0])
      expect(finding).toBeDefined()
      expect(explanation.evidenceIds).toEqual(finding!.evidenceIds)
    }
  })

  it('insight recommendations still generated alongside finding recommendations', () => {
    const result = pipeline.run({
      workspaceId: WORKSPACE_ID,
      files: minimalRepo,
      externalEvidence: makeExternalEvidence(),
    })

    const insightRecs = result.recommendations.filter((r) => r.origin === 'insight')
    const findingRecs = result.recommendations.filter((r) => r.origin === 'finding')

    expect(insightRecs.length).toBeGreaterThan(0)
    expect(findingRecs.length).toBeGreaterThan(0)
  })

  it('no duplicate recommendations across insight and finding origins', () => {
    const result = pipeline.run({
      workspaceId: WORKSPACE_ID,
      files: minimalRepo,
      externalEvidence: makeExternalEvidence(),
    })

    const keys = result.recommendations.map((r) => r.deduplicationKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
