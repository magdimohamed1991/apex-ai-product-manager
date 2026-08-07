import { describe, it, expect } from 'vitest'
import { RepositoryDiscoveryPipeline } from '../RepositoryDiscoveryPipeline'
import type { RepositoryFiles } from '../../repository/StaticRepositoryAnalyzer'

const MOCK_WORKSPACE_ID = 'ws-test-001' as ReturnType<
  typeof import('@apex/ai-core').createWorkspaceId
>

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

describe('RepositoryDiscoveryPipeline', () => {
  const pipeline = new RepositoryDiscoveryPipeline()

  describe('minimal repository', () => {
    it('runs without throwing', () => {
      expect(() =>
        pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      ).not.toThrow()
    })

    it('produces a summary', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      expect(result.summary).toBeDefined()
      expect(result.summary.name).toBe('app')
    })

    it('collects evidence', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      expect(result.evidence.length).toBeGreaterThan(0)
    })

    it('generates insights for missing tests', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      const noTestInsight = result.insights.find((i) => i.tags.includes('no-tests'))
      expect(noTestInsight).toBeDefined()
    })

    it('generates insights for missing CI', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      const noCIInsight = result.insights.find((i) => i.tags.includes('no-ci'))
      expect(noCIInsight).toBeDefined()
    })

    it('generates recommendations for missing tests', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      const rec = result.recommendations.find((r) => r.title.toLowerCase().includes('test'))
      expect(rec).toBeDefined()
    })

    it('measures duration', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('well-configured repository', () => {
    it('does not generate no-tests insight', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: wellConfiguredRepo })
      const noTest = result.insights.find((i) => i.tags.includes('no-tests'))
      expect(noTest).toBeUndefined()
    })

    it('detects monorepo', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: wellConfiguredRepo })
      const monorepoInsight = result.insights.find((i) => i.tags.includes('monorepo-detected'))
      expect(monorepoInsight).toBeDefined()
    })

    it('scores higher than minimal repo', () => {
      const minimal = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      const well = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: wellConfiguredRepo })
      expect(well.summary.score).toBeGreaterThan(minimal.summary.score)
    })

    it('produces fewer risk insights', () => {
      const minimal = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      const well = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: wellConfiguredRepo })
      const riskSeverities = ['critical', 'high', 'medium']
      const minimalRisks = minimal.insights.filter((i) => riskSeverities.includes(i.severity))
      const wellRisks = well.insights.filter((i) => riskSeverities.includes(i.severity))
      expect(wellRisks.length).toBeLessThan(minimalRisks.length)
    })
  })

  describe('insight structure', () => {
    it('all insights have workspaceId', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      result.insights.forEach((i) => expect(i.workspaceId).toBe(MOCK_WORKSPACE_ID))
    })

    it('all insights have source github', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      result.insights.forEach((i) => expect(i.source).toBe('github'))
    })

    it('all insights have rule-based tag', () => {
      const result = pipeline.run({ workspaceId: MOCK_WORKSPACE_ID, files: minimalRepo })
      result.insights.forEach((i) => expect(i.tags).toContain('rule-based'))
    })
  })
})
