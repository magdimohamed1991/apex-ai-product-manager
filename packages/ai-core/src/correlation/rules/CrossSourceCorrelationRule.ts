import type { Evidence } from '@apex/analysis'
import type { CorrelationRule } from '../contracts/CorrelationRule'
import type { CorrelationCandidate } from '../contracts/CorrelationCandidate'
import { scoreCorrelation, hasTemporalOverlap } from '../scoring'

const MIN_SOURCES = 3

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
    const bySource = new Map<string, Evidence[]>()
    for (const e of evidence) {
      const list = bySource.get(e.source) ?? []
      list.push(e)
      bySource.set(e.source, list)
    }

    if (bySource.size < MIN_SOURCES) return []

    const activeSources = [...bySource.entries()].filter(([, items]) => items.length > 0)
    if (activeSources.length < MIN_SOURCES) return []

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

    // ── Temporal proximity check ─────────────────────────────────────────────
    // At least two evidence items from different sources must overlap within 30 days.
    let hasTemporalSignal = false
    const sourceList = activeSources.map(([, items]) => items)
    outer: for (let i = 0; i < sourceList.length; i++) {
      for (let j = i + 1; j < sourceList.length; j++) {
        if (hasTemporalOverlap(sourceList[i], sourceList[j], 30)) {
          hasTemporalSignal = true
          break outer
        }
      }
    }

    if (!hasTemporalSignal) {
      return []
    }

    // ── Build candidate ──────────────────────────────────────────────────────
    // Topic similarity is the ratio of shared keys to total unique keys seen.
    const totalUniqueKeys = new Set(activeSources.flatMap(([, items]) => items.map((e) => e.key)))
      .size
    const topicSimilarity = Math.min(sharedKeys.length / totalUniqueKeys, 1)

    const allEvidence = activeSources.flatMap(([, items]) => items)
    const sourceTypes = activeSources.map(
      ([source]) => source
    ) as CorrelationCandidate['sourceTypes']

    return [
      {
        id: `${this.id}:${sourceTypes.sort().join('-')}`,
        evidenceIds: allEvidence.map((e) => e.id),
        sourceTypes,
        score: scoreCorrelation(sourceTypes, allEvidence, topicSimilarity),
        reason: `Signals were detected across ${activeSources.length} independent sources (${sourceTypes.join(', ')}) with shared subject matter (${sharedKeys.join(', ')}) and temporal proximity. Higher confidence from source diversity — not from proven causation. Cross-referencing these signals may surface a common underlying issue.`,
        ruleId: this.id,
        createdAt: new Date(),
      },
    ]
  }
}
