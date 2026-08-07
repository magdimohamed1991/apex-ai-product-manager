/**
 * IntegrationType is an alias for SourceType.
 * Uses the canonical SourceType from @apex/contracts.
 *
 * This eliminates the dual enum problem (google-play vs google_play).
 */
export type { SourceType as IntegrationType } from '@apex/contracts'
export { ALL_SOURCE_TYPES as INTEGRATION_TYPES } from '@apex/contracts'
