import type { RepositorySummary } from './RepositorySummary'

export interface RepositoryFiles {
  url: string
  packageJson?: Record<string, unknown>
  hasDockerfile: boolean
  hasPnpmWorkspace: boolean
  hasTurboJson: boolean
  hasGitHubActions: boolean
  hasJestConfig: boolean
  hasVitestConfig: boolean
  hasTailwindConfig: boolean
  hasTypeScriptConfig: boolean
  fileList: string[]
}

/**
 * Analyzes repository metadata without calling any LLM.
 * Pure static analysis based on file presence and package.json content.
 */
export class StaticRepositoryAnalyzer {
  analyze(files: RepositoryFiles): RepositorySummary {
    const pkg = files.packageJson ?? {}
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    }

    const name = this.extractName(files.url)
    const owner = this.extractOwner(files.url)
    const languages = this.detectLanguages(files, deps)
    const frameworks = this.detectFrameworks(deps)
    const packageManager = this.detectPackageManager(files)
    const hasTests = files.hasJestConfig || files.hasVitestConfig
    const hasMonorepo = files.hasPnpmWorkspace || files.hasTurboJson
    const complexity = this.assessComplexity(files, deps)
    const score = this.calculateScore({
      hasDocker: files.hasDockerfile,
      hasCI: files.hasGitHubActions,
      hasTests,
      hasMonorepo,
      hasTypeScript: files.hasTypeScriptConfig,
    })

    return {
      name,
      owner,
      url: files.url,
      languages,
      frameworks,
      packageManager,
      hasDocker: files.hasDockerfile,
      hasCI: files.hasGitHubActions,
      hasTests,
      hasMonorepo,
      hasTypeScript: files.hasTypeScriptConfig,
      hasTailwind: files.hasTailwindConfig,
      complexity,
      score,
    }
  }

  private extractName(url: string): string {
    return url.split('/').pop()?.replace('.git', '') ?? 'unknown'
  }

  private extractOwner(url: string): string {
    const parts = url.split('/')
    return parts[parts.length - 2] ?? 'unknown'
  }

  private detectLanguages(files: RepositoryFiles, deps: Record<string, string>): string[] {
    const langs: string[] = []
    if (files.hasTypeScriptConfig || 'typescript' in deps) langs.push('TypeScript')
    else langs.push('JavaScript')
    if ('python' in deps || files.fileList.some((f) => f.endsWith('.py'))) langs.push('Python')
    return langs
  }

  private detectFrameworks(deps: Record<string, string>): string[] {
    const map: Record<string, string> = {
      react: 'React',
      vue: 'Vue',
      svelte: 'Svelte',
      next: 'Next.js',
      vite: 'Vite',
      express: 'Express',
      fastapi: 'FastAPI',
      turbo: 'Turborepo',
    }
    return Object.entries(map)
      .filter(([pkg]) => pkg in deps)
      .map(([, name]) => name)
  }

  private detectPackageManager(files: RepositoryFiles): RepositorySummary['packageManager'] {
    if (files.hasPnpmWorkspace) return 'pnpm'
    if (files.fileList.includes('yarn.lock')) return 'yarn'
    if (files.fileList.includes('bun.lockb')) return 'bun'
    if (files.fileList.includes('package-lock.json')) return 'npm'
    return 'unknown'
  }

  private assessComplexity(
    files: RepositoryFiles,
    deps: Record<string, string>
  ): RepositorySummary['complexity'] {
    const score =
      (files.hasPnpmWorkspace ? 2 : 0) +
      (files.hasTurboJson ? 2 : 0) +
      (files.hasDockerfile ? 1 : 0) +
      (files.hasGitHubActions ? 1 : 0) +
      Object.keys(deps).length / 10

    if (score >= 8) return 'high'
    if (score >= 4) return 'medium'
    return 'low'
  }

  private calculateScore(signals: {
    hasDocker: boolean
    hasCI: boolean
    hasTests: boolean
    hasMonorepo: boolean
    hasTypeScript: boolean
  }): number {
    let score = 40 // base
    if (signals.hasTypeScript) score += 20
    if (signals.hasCI) score += 15
    if (signals.hasTests) score += 15
    if (signals.hasDocker) score += 5
    if (signals.hasMonorepo) score += 5
    return Math.min(score, 100)
  }
}
