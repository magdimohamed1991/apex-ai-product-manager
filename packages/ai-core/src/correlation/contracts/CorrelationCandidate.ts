import type { SourceType } from '../../domain/sources'

/**
 * A CorrelationCandidate is a hypothesis — not a Finding.
 *
 * It says: "These signals from different sources appear related."
 * It does NOT say: "This caused that."
 *
 * The system surfaces correlated signals.
 * The Product Manager decides what it means.
 */
export interface CorrelationCandidate {
  id: string
  evidenceIds: string[]
  sourceTypes: SourceType[]
  score: number // 0–1, deterministic
  reason: string // human-readable, no causality claims
  ruleId: string
  createdAt: Date
}
