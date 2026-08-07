/**
 * All data sources APEX can connect to.
 * Each source produces Evidence that flows into the Correlation Engine.
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
