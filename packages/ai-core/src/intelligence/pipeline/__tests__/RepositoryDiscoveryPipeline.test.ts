import { describe, it, expect } from 'vitest'
import { RepositoryDiscoveryPipeline } from '../RepositoryDiscoveryPipeline'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { RepositoryFiles } from '@apex/analysis'

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

  it('no duplicate recommendations', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    const ids = result.recommendations.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
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
