import type { SourceType, EvidenceType, SourceReference } from '@apex/contracts'

/**
 * Evidence is a raw fact collected from a source.
 * It contains no opinion — only observable truths.
 *
 * Provenance invariant: when `sourceReference` is present,
 * `source` MUST equal `sourceReference.sourceType`.
 * Use `createEvidence()` to construct Evidence safely.
 */
export interface Evidence {
  id: string
  type: EvidenceType
  source: SourceType // must match sourceReference.sourceType when sourceReference is present
  key: string
  value: unknown
  confidence: number // 0–1
  collectedAt: Date
  sourceReference?: SourceReference
}

/**
 * Type alias kept for backward compatibility.
 * Prefer SourceReference from @apex/contracts.
 * @deprecated Use SourceReference from @apex/contracts directly.
 */
export type EvidenceSourceReference = SourceReference

/**
 * Factory function that constructs Evidence and enforces the provenance invariant:
 * `source` must match `sourceReference.sourceType` when both are present.
 *
 * Always prefer this over constructing Evidence object literals directly
 * when sourceReference is involved.
 */
export function createEvidence(data: Evidence): Evidence {
  if (data.sourceReference !== undefined && data.source !== data.sourceReference.sourceType) {
    throw new Error(
      `Evidence provenance mismatch: source "${data.source}" does not match ` +
        `sourceReference.sourceType "${data.sourceReference.sourceType}" on evidence id "${data.id}"`
    )
  }
  return data
}
