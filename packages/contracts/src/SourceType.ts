/**
 * Canonical source type shared across all APEX packages.
 * Uses snake_case to match external system identifiers.
 *
 * This is the single source of truth for source identity.
 * Never define source types in individual packages.
 */
export type SourceType =
  'github' | 'slack' | 'linear' | 'jira' | 'amplitude' | 'google_play' | 'app_store' | 'website'

export const ALL_SOURCE_TYPES: SourceType[] = [
  'github',
  'slack',
  'linear',
  'jira',
  'amplitude',
  'google_play',
  'app_store',
  'website',
]

export const SOURCE_LABELS: Record<SourceType, string> = {
  github: 'GitHub',
  slack: 'Slack',
  linear: 'Linear',
  jira: 'Jira',
  amplitude: 'Amplitude',
  google_play: 'Google Play',
  app_store: 'App Store',
  website: 'Website',
}
