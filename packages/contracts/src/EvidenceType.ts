/**
 * Canonical evidence types shared across all APEX packages.
 * Every Evidence item must have one of these types.
 */
export type EvidenceType =
  | 'dependency'
  | 'testing'
  | 'ci'
  | 'docker'
  | 'monorepo'
  | 'typescript'
  | 'framework'
  | 'package_manager'
  | 'complexity'
  | 'score'
  | 'language'
  | 'metric' // Amplitude / analytics signals
  | 'review' // App Store / Google Play reviews
  | 'code_change' // GitHub commits / PRs
  | 'issue' // Linear / Jira issues
  | 'message' // Slack messages
