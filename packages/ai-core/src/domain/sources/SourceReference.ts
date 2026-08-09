import type { Source } from './Source'
import type { SourceReference } from '@apex/contracts'

export type { SourceReference } from '@apex/contracts'

/**
 * Validates the persistence invariant between a SourceReference and its target Source.
 * This contract MUST be enforced by any persistence boundary (e.g. repository, database).
 */
export function validatePersistenceSourceReference(ref: SourceReference, source: Source): void {
  if (ref.sourceId !== source.id) {
    throw new Error(
      `Persistence validation failed: SourceReference.sourceId "${ref.sourceId}" does not match Source.id "${source.id}"`
    )
  }
  if (ref.sourceType !== source.type) {
    throw new Error(
      `Persistence validation failed: SourceReference.sourceType "${ref.sourceType}" does not match Source.type "${source.type}"`
    )
  }
}
