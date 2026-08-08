import type { SourceType } from './SourceType'

/**
 * Links a piece of Evidence back to its exact origin in an external system.
 * Canonical definition — shared between @apex/analysis and @apex/ai-core.
 *
 * Enables explainability: Finding → Evidence → SourceReference (the ground truth artifact).
 *
 * sourceType is the single source of truth for the evidence origin.
 * When Evidence has both a top-level `source` field and a `sourceReference`,
 * they MUST agree: source === sourceReference.sourceType.
 */
export interface SourceReference {
  sourceId: string
  sourceType: SourceType
  externalId: string // ID in the external system (PR number, review ID, event ID...)
  url: string | null // direct link to the original artifact
  title: string // human-readable description of the artifact
  capturedAt: Date
}
