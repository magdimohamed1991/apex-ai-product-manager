import { describe, it, expect } from 'vitest'
import { MetricReviewCorrelationRule } from '../rules/MetricReviewCorrelationRule'
import { MetricCodeCorrelationRule } from '../rules/MetricCodeCorrelationRule'
import { CrossSourceCorrelationRule } from '../rules/CrossSourceCorrelationRule'
import type { Evidence } from '@apex/analysis'

function makeEvidence(
  id: string,
  source: Evidence['source'],
  value: unknown,
  daysAgo = 0,
  type: Evidence['type'] = 'testing'
): Evidence {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return {
    id,
    type,
    source,
    key: 'signal',
    value,
    confidence: 1,
    collectedAt: date,
  }
}

describe('MetricReviewCorrelationRule', () => {
  const rule = new MetricReviewCorrelationRule()

  it('returns candidate when amplitude drop + google play reviews overlap', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -18, 0, 'metric'),
      makeEvidence('gplay-1', 'google_play', 27, 5, 'review'),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('returns empty when no amplitude evidence', () => {
    const evidence = [makeEvidence('gplay-1', 'google_play', 10, 0, 'review')]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('returns empty when no review evidence', () => {
    const evidence = [makeEvidence('amp-1', 'amplitude', -10, 0, 'metric')]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('returns empty when metric is positive (not degrading)', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', 5, 0, 'metric'), // positive = good
      makeEvidence('gplay-1', 'google_play', 10, 0, 'review'),
    ]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('returns empty when temporal overlap is missing', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -18, 0, 'metric'),
      makeEvidence('gplay-1', 'google_play', 10, 90, 'review'), // 90 days ago — no overlap
    ]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('candidate reason does not claim causation', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -18, 0, 'metric'),
      makeEvidence('gplay-1', 'google_play', 5, 5, 'review'),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates[0]?.reason).not.toMatch(/caused|because|due to/i)
  })

  it('candidate includes evidence ids', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -18, 0, 'metric'),
      makeEvidence('gplay-1', 'google_play', 5, 5, 'review'),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates[0]?.evidenceIds).toContain('amp-1')
    expect(candidates[0]?.evidenceIds).toContain('gplay-1')
  })

  it('matches canonical SourceType (google_play) and EvidenceType (metric + review)', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -20, 0, 'metric'),
      makeEvidence('gplay-1', 'google_play', 15, 3, 'review'),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates.length).toBe(1)
    expect(candidates[0].sourceTypes).toContain('amplitude')
    expect(candidates[0].sourceTypes).toContain('google_play')
    expect(candidates[0].ruleId).toBe('metric-review-correlation')
  })

  it('matches app_store (not just google_play)', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -20, 0, 'metric'),
      makeEvidence('astore-1', 'app_store', 12, 2, 'review'),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates.length).toBe(1)
    expect(candidates[0].sourceTypes).toContain('app_store')
  })

  it('rejects legacy dashed source types (google-play)', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -20, 0, 'metric'),
      makeEvidence('gplay-1', 'google-play' as Evidence['source'], 15, 3, 'review'),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates).toHaveLength(0)
  })
})

describe('MetricCodeCorrelationRule', () => {
  const rule = new MetricCodeCorrelationRule()

  it('returns candidate when amplitude drop + github changes overlap', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gh-1', 'github', 'checkout.ts changed', 3),
    ]
    expect(rule.evaluate(evidence).length).toBeGreaterThan(0)
  })

  it('returns empty when no github evidence', () => {
    const evidence = [makeEvidence('amp-1', 'amplitude', -10, 0)]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('returns empty when no amplitude evidence', () => {
    const evidence = [makeEvidence('gh-1', 'github', 'change', 0)]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('returns empty when no temporal overlap', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gh-1', 'github', 'change', 60),
    ]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('candidate reason does not claim causation', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gh-1', 'github', 'change', 5),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates[0]?.reason).not.toMatch(/caused|because|due to/i)
    expect(candidates[0]?.reason).toMatch(/temporal|overlap/i)
  })
})

describe('CrossSourceCorrelationRule', () => {
  const rule = new CrossSourceCorrelationRule()

  it('returns candidate for 3+ sources', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gplay-1', 'google_play', 10, 5),
      makeEvidence('gh-1', 'github', 'change', 3),
    ]
    expect(rule.evaluate(evidence).length).toBeGreaterThan(0)
  })

  it('returns empty for 2 sources', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gplay-1', 'google_play', 10, 5),
    ]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('returns empty for 1 source', () => {
    const evidence = [makeEvidence('amp-1', 'amplitude', -15, 0)]
    expect(rule.evaluate(evidence)).toHaveLength(0)
  })

  it('score is higher for 4 sources than 3', () => {
    const three: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gplay-1', 'google_play', 10, 5),
      makeEvidence('gh-1', 'github', 'change', 3),
    ]
    const four: Evidence[] = [...three, makeEvidence('slack-1', 'slack', 'mention', 2)]
    const s3 = rule.evaluate(three)[0]?.score ?? 0
    const s4 = rule.evaluate(four)[0]?.score ?? 0
    expect(s4).toBeGreaterThan(s3)
  })

  it('candidate reason mentions source diversity', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gplay-1', 'google_play', 10, 5),
      makeEvidence('gh-1', 'github', 'change', 3),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates[0]?.reason).toMatch(/independent sources/i)
  })

  it('result is deterministic', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gplay-1', 'google_play', 10, 5),
      makeEvidence('gh-1', 'github', 'change', 3),
    ]
    const r1 = rule.evaluate(evidence)
    const r2 = rule.evaluate(evidence)
    expect(r1[0]?.score).toBe(r2[0]?.score)
    expect(r1[0]?.id).toBe(r2[0]?.id)
  })

  it('correlates realistic evidence with same key across 3 sources', () => {
    const now = new Date()
    const d5 = new Date()
    d5.setDate(d5.getDate() - 5)
    const d3 = new Date()
    d3.setDate(d3.getDate() - 3)
    const evidence: Evidence[] = [
      {
        id: 'amp-checkout',
        type: 'metric',
        source: 'amplitude',
        key: 'checkout',
        value: -18,
        confidence: 0.9,
        collectedAt: now,
      },
      {
        id: 'gplay-checkout',
        type: 'review',
        source: 'google_play',
        key: 'checkout',
        value: 'users report checkout failures',
        confidence: 0.8,
        collectedAt: d5,
      },
      {
        id: 'gh-checkout',
        type: 'testing',
        source: 'github',
        key: 'checkout',
        value: 'checkout.ts modified',
        confidence: 0.95,
        collectedAt: d3,
      },
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates.length).toBe(1)
    expect(candidates[0].ruleId).toBe('cross-source-correlation')
    expect(candidates[0].evidenceIds).toContain('amp-checkout')
    expect(candidates[0].evidenceIds).toContain('gplay-checkout')
    expect(candidates[0].evidenceIds).toContain('gh-checkout')
  })

  it('does NOT correlate when shared key evidence is >30 days apart', () => {
    const now = new Date()
    const d60 = new Date()
    d60.setDate(d60.getDate() - 60)
    const d2 = new Date()
    d2.setDate(d2.getDate() - 2)
    const evidence: Evidence[] = [
      {
        id: 'amp-checkout',
        type: 'metric',
        source: 'amplitude',
        key: 'checkout',
        value: -18,
        confidence: 0.9,
        collectedAt: now,
      },
      {
        id: 'gplay-checkout',
        type: 'review',
        source: 'google_play',
        key: 'checkout',
        value: 'checkout issues',
        confidence: 0.8,
        collectedAt: d60,
      },
      {
        id: 'gh-unrelated',
        type: 'testing',
        source: 'github',
        key: 'readme',
        value: 'readme updated',
        confidence: 0.5,
        collectedAt: d2,
      },
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates).toHaveLength(0)
  })

  it('only counts sources that participate in the correlated signal', () => {
    const now = new Date()
    const d3 = new Date()
    d3.setDate(d3.getDate() - 3)
    const evidence: Evidence[] = [
      {
        id: 'amp-checkout',
        type: 'metric',
        source: 'amplitude',
        key: 'checkout',
        value: -18,
        confidence: 0.9,
        collectedAt: now,
      },
      {
        id: 'gplay-checkout',
        type: 'review',
        source: 'google_play',
        key: 'checkout',
        value: 'checkout issues',
        confidence: 0.8,
        collectedAt: d3,
      },
      {
        id: 'gh-unrelated',
        type: 'testing',
        source: 'github',
        key: 'readme',
        value: 'readme updated',
        confidence: 0.5,
        collectedAt: d3,
      },
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates).toHaveLength(0)
  })

  it('correlation ID includes shared signal name', () => {
    const evidence: Evidence[] = [
      makeEvidence('amp-1', 'amplitude', -15, 0),
      makeEvidence('gplay-1', 'google_play', 10, 5),
      makeEvidence('gh-1', 'github', 'change', 3),
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates[0].id).toMatch(/signal/)
  })

  it('rejects correlation when shared key is temporally distant but unrelated evidence overlaps', () => {
    const now = new Date()
    const d3 = new Date()
    d3.setDate(d3.getDate() - 3)
    const d90 = new Date()
    d90.setDate(d90.getDate() - 90)
    const evidence: Evidence[] = [
      {
        id: 'amp-1',
        type: 'metric',
        source: 'amplitude',
        key: 'checkout',
        value: -18,
        confidence: 1,
        collectedAt: now,
      },
      {
        id: 'gh-1',
        type: 'testing',
        source: 'github',
        key: 'unrelated',
        value: 'change',
        confidence: 1,
        collectedAt: d3,
      },
      {
        id: 'gplay-1',
        type: 'review',
        source: 'google_play',
        key: 'checkout',
        value: 27,
        confidence: 1,
        collectedAt: d90,
      },
    ]
    const candidates = rule.evaluate(evidence)
    expect(candidates).toHaveLength(0)
  })

  it('produces different IDs for different shared signals from same sources', () => {
    const now = new Date()
    const d3 = new Date()
    d3.setDate(d3.getDate() - 3)
    const evidenceA: Evidence[] = [
      {
        id: 'amp-1',
        type: 'metric',
        source: 'amplitude',
        key: 'checkout',
        value: -18,
        confidence: 0.9,
        collectedAt: now,
      },
      {
        id: 'gplay-1',
        type: 'review',
        source: 'google_play',
        key: 'checkout',
        value: 'issues',
        confidence: 0.8,
        collectedAt: d3,
      },
      {
        id: 'gh-1',
        type: 'testing',
        source: 'github',
        key: 'checkout',
        value: 'changed',
        confidence: 0.95,
        collectedAt: d3,
      },
    ]
    const evidenceB: Evidence[] = [
      {
        id: 'amp-2',
        type: 'metric',
        source: 'amplitude',
        key: 'payments',
        value: -10,
        confidence: 0.9,
        collectedAt: now,
      },
      {
        id: 'gplay-2',
        type: 'review',
        source: 'google_play',
        key: 'payments',
        value: 'issues',
        confidence: 0.8,
        collectedAt: d3,
      },
      {
        id: 'gh-2',
        type: 'testing',
        source: 'github',
        key: 'payments',
        value: 'changed',
        confidence: 0.95,
        collectedAt: d3,
      },
    ]
    const idA = rule.evaluate(evidenceA)[0]?.id
    const idB = rule.evaluate(evidenceB)[0]?.id
    expect(idA).not.toBe(idB)
  })
})
