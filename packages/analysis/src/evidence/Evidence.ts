/**
 * Evidence is a raw fact collected from a source.
 * It contains no opinion — only observable truths.
 *
 * Examples:
 *   { type: "dependency", key: "packageManager", value: "pnpm" }
 *   { type: "testing",    key: "testCount",      value: 0 }
 *   { type: "ci",         key: "githubActions",  value: true }
 */
export interface Evidence {
  id: string
  type: EvidenceType
  source: EvidenceSource
  key: string
  value: unknown
  confidence: number // 0–1
  collectedAt: Date
}

export type EvidenceSource =
  'github' | 'linear' | 'slack' | 'amplitude' | 'app-store' | 'google-play'

export type EvidenceType =
  | 'dependency'
  | 'testing'
  | 'ci'
  | 'docker'
  | 'monorepo'
  | 'typescript'
  | 'framework'
  | 'package-manager'
  | 'complexity'
  | 'score'
  | 'language'
