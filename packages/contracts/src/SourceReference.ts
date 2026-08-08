import type { SourceType } from './SourceType'

/**
 * Links a piece of Evidence back to its exact origin in an external system.
 * Canonical definition — shared between @apex/analysis and @apex/ai-core.
 *
 * Enables explainability: Finding → Evidence → SourceReference (the ground truth artifact).
 *
 * Invariants:
 * - sourceType is the single source of truth for the evidence origin.
 * - When Evidence has both a top-level `source` field and a `sourceReference`,
 *   they MUST agree: source === sourceReference.sourceType.
 * - sourceId refers to the workspace-local Source entity ID (Source.id).
 *   Multiple connections of the same type (e.g. two GitHub repos) have
 *   distinct sourceId values. sourceType categorizes the connection kind;
 *   sourceId identifies the specific connection instance.
 * - sourceId === Source.id is an invariant enforced at the persistence layer.
 */
export interface SourceReference {
  sourceId: string // Workspace-local Source entity ID (Source.id). Must match Source.id.
  sourceType: SourceType // Connection kind: 'github', 'slack', etc. Must match Source.type.
  externalId: string // ID in the external system (PR number, review ID, event ID...)
  url: string | null // direct link to the original artifact
  title: string // human-readable description of the artifact
  capturedAt: Date
}
