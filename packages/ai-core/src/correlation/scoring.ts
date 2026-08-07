import type { SourceType } from '../domain/sources'
import type { Evidence } from '@apex/analysis'

/**
 * Deterministic scoring for correlation candidates.
 * No ML or LLM — pure signal strength calculation.
 */

const SOURCE_DIVERSITY_BONUS: Record<number, number> = {
  1: 0.0, // single source = no correlation
  2: 0.5, // two sources = baseline
  3: 0.7, // three sources = stronger
  4: 0.85, // four sources = very strong
}

export function scoreCorrelation(
  sourceTypes: SourceType[],
  evidence: Evidence[],
  topicSimilarity: number // 0–1, caller provides
): number {
  const uniqueSources = new Set(sourceTypes).size
  const diversityBase = SOURCE_DIVERSITY_BONUS[uniqueSources] ?? 0.9

  // Average confidence of contributing evidence
  const avgConfidence =
    evidence.length > 0 ? evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length : 0.5

  // Topic similarity weight
  const topicWeight = 0.5 + topicSimilarity * 0.5

  const raw = diversityBase * avgConfidence * topicWeight
  return Math.min(Math.round(raw * 100) / 100, 1)
}

export function hasTemporalOverlap(
  evidenceA: Evidence[],
  evidenceB: Evidence[],
  windowDays = 30
): boolean {
  const windowMs = windowDays * 24 * 60 * 60 * 1000

  for (const a of evidenceA) {
    for (const b of evidenceB) {
      const diff = Math.abs(a.collectedAt.getTime() - b.collectedAt.getTime())
      if (diff <= windowMs) return true
    }
  }
  return false
}
