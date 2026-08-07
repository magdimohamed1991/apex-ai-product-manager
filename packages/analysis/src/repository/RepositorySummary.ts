/**
 * Output of static repository analysis.
 * No LLM involved — pure file inspection.
 */
export interface RepositorySummary {
  name: string
  owner: string
  url: string

  languages: string[]
  frameworks: string[]
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'

  hasDocker: boolean
  hasCI: boolean
  hasTests: boolean
  hasMonorepo: boolean
  hasTypeScript: boolean
  hasTailwind: boolean

  complexity: 'low' | 'medium' | 'high'
  score: number // 0–100 readiness score
}
