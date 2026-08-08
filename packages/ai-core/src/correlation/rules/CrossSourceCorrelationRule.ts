import type { Evidence } from '@apex/analysis'
import type { CorrelationRule } from '../contracts/CorrelationRule'
import type { CorrelationCandidate } from '../contracts/CorrelationCandidate'
import { scoreCorrelation, hasTemporalOverlap } from '../scoring'

const MIN_SOURCES = 3
const TEMPORAL_WINDOW_DAYS = 30

/**
 * Detects semantically related signals appearing across 3+ independent sources.
 *
 * Two conditions must both be satisfied:
 *
 * 1. Shared signal: evidence items from different sources must share at least
 *    one common key (e.g. 'checkout', 'signal', 'conversion') — ensuring that
 *    source diversity reflects actual overlapping subject matter, not coincidence.
 *
 * 2. Temporal proximity: at least one pair of evidence items from different
 *    sources must fall within a 30-day window — ensuring the signals are
 *    contemporaneous, not arbitrarily distant in time.
 *
 * This prevents false positives from source diversity alone:
 *   Amplitude checkout signal + unrelated GitHub README change + vacation Slack message
 *   would fail the shared-signal requirement and produce no candidate.
 *
 * Score is derived from source diversity × evidence confidence × topic similarity
 * (shared-key overlap ratio across sources).
 * Higher confidence from more sources AND higher key overlap.
 */
export class CrossSourceCorrelationRule implements CorrelationRule {
  readonly id = 'cross-source-correlation'
  readonly name = 'Cross-Source Correlation (3+ sources, shared signal)'

  evaluate(evidence: Evidence[]): CorrelationCandidate[] {
    // Group evidence by source
    const bySource = new Map<Evidence['source'], Evidence[]>()
    for (const e of evidence) {
      const list = bySource.get(e.source) ?? []
      list.push(e)
      bySource.set(e.source, list)
    }

    if (bySource.size < MIN_SOURCES) return []

    const activeSources = [...bySource.entries()]

    // ── Shared signal check ──────────────────────────────────────────────────
    // Find keys that appear in evidence from at least 2 different sources.
    const keyToSources = new Map<string, Set<string>>()
    for (const [source, items] of activeSources) {
      for (const item of items) {
        const sources = keyToSources.get(item.key) ?? new Set()
        sources.add(source)
        keyToSources.set(item.key, sources)
      }
    }

    const sharedKeys = [...keyToSources.entries()]
      .filter(([, sources]) => sources.size >= 2)
      .map(([key]) => key)

    if (sharedKeys.length === 0) {
      // No overlapping subject matter across sources — not a meaningful correlation
      return []
    }

    // ── Temporal proximity check (per shared key) ──────────────────────────────
    // For each shared key, collect evidence carrying that key grouped by source.
    // Require ≥2 sources AND temporal proximity among those same evidence items.
    let hasValidCorrelation = false
    const correlatedEvidenceIds = new Set<string>()
    const correlatedSharedKeys: string[] = []

    for (const sharedKey of sharedKeys) {
      const keyEvidenceBySource = new Map<string, Evidence[]>()
      for (const [source, items] of activeSources) {
        const matching = items.filter((item) => item.key === sharedKey)
        if (matching.length > 0) {
          keyEvidenceBySource.set(source, matching)
        }
      }

      if (keyEvidenceBySource.size < 2) continue

      const sourceArrays = [...keyEvidenceBySource.values()]
      let keyHasTemporalOverlap = false
      for (let i = 0; i < sourceArrays.length; i++) {
        for (let j = i + 1; j < sourceArrays.length; j++) {
          if (hasTemporalOverlap(sourceArrays[i], sourceArrays[j], TEMPORAL_WINDOW_DAYS)) {
            keyHasTemporalOverlap = true
            break
          }
        }
        if (keyHasTemporalOverlap) break
      }

      if (keyHasTemporalOverlap) {
        hasValidCorrelation = true
        correlatedSharedKeys.push(sharedKey)
        for (const items of keyEvidenceBySource.values()) {
          for (const item of items) {
            correlatedEvidenceIds.add(item.id)
          }
        }
      }
    }

    if (!hasValidCorrelation) {
      return []
    }

    // ── Build candidate ──────────────────────────────────────────────────────
    const allEvidence = activeSources.flatMap(([, items]) => items)
    const contributingEvidence = allEvidence.filter((e) => correlatedEvidenceIds.has(e.id))
    const totalUniqueKeys = new Set(activeSources.flatMap(([, items]) => items.map((e) => e.key)))
      .size
    const topicSimilarity = Math.min(correlatedSharedKeys.length / totalUniqueKeys, 1)

    const sourceTypes = activeSources.map(
      ([source]) => source
    ) as CorrelationCandidate['sourceTypes']

    return [
      {
        id: `${this.id}:${sourceTypes.sort().join('-')}`,
        evidenceIds: contributingEvidence.map((e) => e.id),
        sourceTypes,
        score: scoreCorrelation(sourceTypes, contributingEvidence, topicSimilarity),
        reason: `Signals were detected across ${activeSources.length} independent sources (${sourceTypes.join(', ')}) with shared subject matter (${correlatedSharedKeys.join(', ')}) and temporal proximity. Higher confidence from source diversity — not from proven causation. Cross-referencing these signals may surface a common underlying issue.`,
        ruleId: this.id,
        createdAt: new Date(),
      },
    ]
  }
}
