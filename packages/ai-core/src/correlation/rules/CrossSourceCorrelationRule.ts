import type { Evidence } from '@apex/analysis'
import type { CorrelationRule } from '../contracts/CorrelationRule'
import type { CorrelationCandidate } from '../contracts/CorrelationCandidate'
import { scoreCorrelation } from '../scoring'

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
 * 2. Temporal proximity: at least one evidence item from each qualifying source
 *    must participate in a common 30-day window — ensuring the signals are
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
    // Find keys that appear in evidence from at least MIN_SOURCES different sources.
    // A single key must span ≥3 sources — not a union of unrelated 2-source correlations.
    const keyToSources = new Map<string, Set<string>>()
    for (const [source, items] of activeSources) {
      for (const item of items) {
        const sources = keyToSources.get(item.key) ?? new Set()
        sources.add(source)
        keyToSources.set(item.key, sources)
      }
    }

    const qualifiedKeys = [...keyToSources.entries()]
      .filter(([, sources]) => sources.size >= MIN_SOURCES)
      .map(([key, sources]) => ({ key, sources: [...sources] as string[] }))

    if (qualifiedKeys.length === 0) {
      return []
    }

    // ── Temporal proximity check (per qualified key) ──────────────────────────
    // For each key that spans ≥3 sources, check temporal overlap among those sources.
    const candidates: CorrelationCandidate[] = []

    for (const { key, sources: keySources } of qualifiedKeys) {
      const keyEvidenceBySource = new Map<string, Evidence[]>()
      for (const [source, items] of activeSources) {
        const matching = items.filter((item) => item.key === key)
        if (matching.length > 0 && keySources.includes(source)) {
          keyEvidenceBySource.set(source, matching)
        }
      }

      if (keyEvidenceBySource.size < MIN_SOURCES) continue

      const windowMs = TEMPORAL_WINDOW_DAYS * 24 * 60 * 60 * 1000
      // Collect one representative date per source (earliest)
      const sourceRepresentatives = [...keyEvidenceBySource.entries()].map(([source, items]) => ({
        source,
        dates: items.map((e) => e.collectedAt.getTime()).sort((a, b) => a - b),
      }))
      // For each source, try its earliest date as the window start
      // Check if all other sources have at least one date within [start, start + windowMs]
      let hasTemporalOverlap = false
      for (const { dates: startDates } of sourceRepresentatives) {
        const windowStart = startDates[0]
        const windowEnd = windowStart + windowMs
        const allSourcesPresent = sourceRepresentatives.every(({ dates }) =>
          dates.some((d) => d >= windowStart && d <= windowEnd)
        )
        if (allSourcesPresent) {
          hasTemporalOverlap = true
          break
        }
      }

      if (!hasTemporalOverlap) continue

      // Collect evidence and sources for this specific key
      const correlatedEvidenceIds = new Set<string>()
      for (const [, items] of keyEvidenceBySource.entries()) {
        for (const item of items) {
          correlatedEvidenceIds.add(item.id)
        }
      }

      const allEvidence = activeSources.flatMap(([, items]) => items)
      const contributingEvidence = allEvidence.filter((e) => correlatedEvidenceIds.has(e.id))
      const topicSimilarity = 1.0

      const sortedSources = keySources.sort() as CorrelationCandidate['sourceTypes']

      candidates.push({
        id: `${this.id}:${sortedSources.join('-')}:${key}`,
        evidenceIds: contributingEvidence.map((e) => e.id),
        sourceTypes: sortedSources,
        score: scoreCorrelation(sortedSources, contributingEvidence, topicSimilarity),
        reason: `The signal "${key}" was detected across ${sortedSources.length} independent sources (${sortedSources.join(', ')}) with temporal proximity. Higher confidence from source diversity — not from proven causation. Cross-referencing these signals may surface a common underlying issue.`,
        ruleId: this.id,
        createdAt: new Date(),
      })
    }

    return candidates
  }
}
