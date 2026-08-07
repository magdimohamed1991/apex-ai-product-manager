import type { SourceType } from './SourceType'

/**
 * A SourceReference links a piece of Evidence back to its exact origin.
 *
 * This enables Explainability:
 *   Finding → Evidence #1 → SourceReference (GitHub PR #42)
 *             Evidence #2 → SourceReference (Google Play review, Jan 2026)
 *             Evidence #3 → SourceReference (Amplitude event, checkout funnel)
 *
 * The system never claims causality — it surfaces correlated signals
 * and lets the Product Manager decide.
 */
export interface SourceReference {
  sourceId: string
  sourceType: SourceType
  externalId: string // ID in the external system (PR number, review ID, event ID...)
  url: string | null // direct link to the original artifact
  title: string // human-readable description of the artifact
  capturedAt: Date
}
