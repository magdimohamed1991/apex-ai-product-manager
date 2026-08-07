import type { SourceType, EvidenceType } from '@apex/contracts'

/**
 * Evidence is a raw fact collected from a source.
 * It contains no opinion — only observable truths.
 *
 * sourceReference is the single source of truth for origin.
 * The `source` field is derived for convenience but must match
 * sourceReference.sourceType when both are present.
 */
export interface Evidence {
  id: string
  type: EvidenceType
  source: SourceType // convenience — must match sourceReference.sourceType
  key: string
  value: unknown
  confidence: number // 0–1
  collectedAt: Date
  sourceReference?: EvidenceSourceReference
}

/**
 * Links Evidence back to its exact origin in an external system.
 * Enables "Why?" — trace any Finding back to ground truth.
 */
export interface EvidenceSourceReference {
  sourceId: string
  sourceType: SourceType
  externalId: string
  url: string | null
  title: string
  capturedAt: Date
}
