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

  it('produces one explanation per insight', () => {
    const result = pipeline.run({ workspaceId: WORKSPACE_ID, files: minimalRepo })
    expect(result.explanations.length).toBe(result.insights.length)
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
})
