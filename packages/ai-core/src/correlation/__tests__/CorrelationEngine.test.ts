import { describe, it, expect } from 'vitest'
import { CorrelationEngine } from '../CorrelationEngine'
import type { Evidence } from '@apex/analysis'

function makeEvidence(
  id: string,
  source: Evidence['source'],
  value: unknown,
  daysAgo = 0
): Evidence {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return {
    id,
    type: 'testing',
    source,
    key: 'signal',
    value,
    confidence: 1,
    collectedAt: date,
  }
}

describe('CorrelationEngine', () => {
  const engine = new CorrelationEngine()

  describe('empty evidence', () => {
    it('returns empty candidates for no evidence', () => {
      const result = engine.evaluate([])
      expect(result.candidates).toHaveLength(0)
      expect(result.evaluatedEvidenceCount).toBe(0)
    })

    it('reports correct rule count', () => {
      const result = engine.evaluate([])
      expect(result.rulesEvaluated).toBe(3)
    })
  })

  describe('single source evidence', () => {
    it('returns no candidates for single-source evidence', () => {
      const evidence = [makeEvidence('amp-1', 'amplitude', -10, 0)]
      const result = engine.evaluate(evidence)
      expect(result.candidates).toHaveLength(0)
    })
  })

  describe('two sources', () => {
    it('detects metric + review correlation', () => {
      const evidence: Evidence[] = [
        makeEvidence('amp-1', 'amplitude', -18, 0),
        makeEvidence('gplay-1', 'google_play', 27, 5),
      ]
      const result = engine.evaluate(evidence)
      expect(result.candidates.length).toBeGreaterThan(0)
    })
  })

  describe('integration — three sources (Amplitude + Google Play + GitHub)', () => {
    it('produces correlated candidates', () => {
      const evidence: Evidence[] = [
        makeEvidence('amp-checkout', 'amplitude', -18, 0),
        makeEvidence('gplay-checkout', 'google_play', 27, 5),
        makeEvidence('gh-checkout', 'github', 'checkout.ts modified', 3),
      ]
      const result = engine.evaluate(evidence)
      expect(result.candidates.length).toBeGreaterThan(0)
    })

    it('candidates are sorted by score descending', () => {
      const evidence: Evidence[] = [
        makeEvidence('amp-checkout', 'amplitude', -18, 0),
        makeEvidence('gplay-checkout', 'google_play', 27, 5),
        makeEvidence('gh-checkout', 'github', 'checkout.ts modified', 3),
      ]
      const result = engine.evaluate(evidence)
      const scores = result.candidates.map((c) => c.score)
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])
      }
    })

    it('cross-source candidate appears when 3 sources share a key', () => {
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
          confidence: 1,
          collectedAt: now,
        },
        {
          id: 'gplay-checkout',
          type: 'review',
          source: 'google_play',
          key: 'checkout',
          value: 27,
          confidence: 1,
          collectedAt: d5,
        },
        {
          id: 'gh-checkout',
          type: 'testing',
          source: 'github',
          key: 'checkout',
          value: 'checkout.ts modified',
          confidence: 1,
          collectedAt: d3,
        },
      ]
      const result = engine.evaluate(evidence)
      const crossSource = result.candidates.find((c) => c.ruleId === 'cross-source-correlation')
      expect(crossSource).toBeDefined()
      expect(crossSource!.evidenceIds).toContain('amp-checkout')
      expect(crossSource!.evidenceIds).toContain('gplay-checkout')
      expect(crossSource!.evidenceIds).toContain('gh-checkout')
    })

    it('cross-source candidate does NOT appear when shared key is temporally distant', () => {
      const now = new Date()
      const d90 = new Date()
      d90.setDate(d90.getDate() - 90)
      const d3 = new Date()
      d3.setDate(d3.getDate() - 3)
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
          id: 'gplay-1',
          type: 'review',
          source: 'google_play',
          key: 'checkout',
          value: 27,
          confidence: 1,
          collectedAt: d90,
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
      ]
      const result = engine.evaluate(evidence)
      const crossSource = result.candidates.find((c) => c.ruleId === 'cross-source-correlation')
      expect(crossSource).toBeUndefined()
    })

    it('all candidate reasons avoid causation language', () => {
      const evidence: Evidence[] = [
        makeEvidence('amp-1', 'amplitude', -18, 0),
        makeEvidence('gplay-1', 'google_play', 10, 5),
        makeEvidence('gh-1', 'github', 'change', 3),
      ]
      const result = engine.evaluate(evidence)
      result.candidates.forEach((c) => {
        expect(c.reason).not.toMatch(/caused|because of|due to/i)
      })
    })

    it('deduplicates candidates with same id', () => {
      const evidence: Evidence[] = [
        makeEvidence('amp-1', 'amplitude', -18, 0),
        makeEvidence('gplay-1', 'google_play', 10, 5),
        makeEvidence('gh-1', 'github', 'change', 3),
      ]
      const result = engine.evaluate(evidence)
      const ids = result.candidates.map((c) => c.id)
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length)
    })
  })

  describe('temporal mismatch', () => {
    it('returns no metric-review correlation when outside time window', () => {
      const evidence: Evidence[] = [
        makeEvidence('amp-1', 'amplitude', -18, 0),
        makeEvidence('gplay-1', 'google_play', 10, 90), // 90 days apart
      ]
      const result = engine.evaluate(evidence)
      const metricReview = result.candidates.filter((c) => c.ruleId === 'metric-review-correlation')
      expect(metricReview).toHaveLength(0)
    })
  })

  describe('result metadata', () => {
    it('sets evaluatedEvidenceCount', () => {
      const evidence: Evidence[] = [
        makeEvidence('a', 'amplitude', -5, 0),
        makeEvidence('b', 'google_play', 3, 0),
      ]
      const result = engine.evaluate(evidence)
      expect(result.evaluatedEvidenceCount).toBe(2)
    })

    it('sets generatedAt', () => {
      const result = engine.evaluate([])
      expect(result.generatedAt).toBeInstanceOf(Date)
    })
  })
})
