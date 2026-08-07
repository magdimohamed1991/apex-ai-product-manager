import { describe, it, expect } from 'vitest'
import { StaticRepositoryAnalyzer } from '../StaticRepositoryAnalyzer'
import type { RepositoryFiles } from '../StaticRepositoryAnalyzer'

const baseFiles: RepositoryFiles = {
  url: 'https://github.com/acme/my-app',
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

describe('StaticRepositoryAnalyzer', () => {
  const analyzer = new StaticRepositoryAnalyzer()

  it('extracts repo name and owner from URL', () => {
    const result = analyzer.analyze(baseFiles)
    expect(result.name).toBe('my-app')
    expect(result.owner).toBe('acme')
  })

  it('detects React from dependencies', () => {
    const result = analyzer.analyze({
      ...baseFiles,
      packageJson: { dependencies: { react: '^19.0.0' } },
    })
    expect(result.frameworks).toContain('React')
  })

  it('detects Vite from devDependencies', () => {
    const result = analyzer.analyze({
      ...baseFiles,
      packageJson: { devDependencies: { vite: '^8.0.0' } },
    })
    expect(result.frameworks).toContain('Vite')
  })

  it('detects Turborepo', () => {
    const result = analyzer.analyze({
      ...baseFiles,
      hasTurboJson: true,
      packageJson: { devDependencies: { turbo: '^2.0.0' } },
    })
    expect(result.frameworks).toContain('Turborepo')
    expect(result.hasMonorepo).toBe(true)
  })

  it('detects pnpm as package manager', () => {
    const result = analyzer.analyze({
      ...baseFiles,
      hasPnpmWorkspace: true,
    })
    expect(result.packageManager).toBe('pnpm')
  })

  it('detects TypeScript', () => {
    const result = analyzer.analyze({
      ...baseFiles,
      hasTypeScriptConfig: true,
    })
    expect(result.hasTypeScript).toBe(true)
    expect(result.languages).toContain('TypeScript')
  })

  it('marks hasTests true when vitest config exists', () => {
    const result = analyzer.analyze({
      ...baseFiles,
      hasVitestConfig: true,
    })
    expect(result.hasTests).toBe(true)
  })

  it('marks hasTests true when jest config exists', () => {
    const result = analyzer.analyze({
      ...baseFiles,
      hasJestConfig: true,
    })
    expect(result.hasTests).toBe(true)
  })

  it('calculates higher score for well-configured repo', () => {
    const well = analyzer.analyze({
      ...baseFiles,
      hasTypeScriptConfig: true,
      hasGitHubActions: true,
      hasVitestConfig: true,
      hasDockerfile: true,
      hasPnpmWorkspace: true,
    })
    const minimal = analyzer.analyze(baseFiles)
    expect(well.score).toBeGreaterThan(minimal.score)
  })

  it('assesses high complexity for large monorepo with many deps', () => {
    const deps: Record<string, string> = {}
    for (let i = 0; i < 60; i++) deps[`pkg-${i}`] = '^1.0.0'
    const result = analyzer.analyze({
      ...baseFiles,
      hasPnpmWorkspace: true,
      hasTurboJson: true,
      hasGitHubActions: true,
      hasDockerfile: true,
      packageJson: { dependencies: deps },
    })
    expect(result.complexity).toBe('high')
  })

  it('assesses low complexity for minimal repo', () => {
    const result = analyzer.analyze(baseFiles)
    expect(result.complexity).toBe('low')
  })
})
