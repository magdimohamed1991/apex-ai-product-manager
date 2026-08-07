import { describe, it, expect } from 'vitest'
import { CorrelationFindingBuilder } from '../CorrelationFindingBuilder'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { CorrelationCandidate } from '../../contracts/CorrelationCandidate'
import type { Evidence } from '@apex/analysis'

const WORKSPACE_ID = createWorkspaceId('ws-step3-test')

function makeEvidence(
  id: string,
  source: Evidence['source'],
  value: unknown,
  daysAgo = 0
): Evidence {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return { id, type: 'testing', source, key: 'signal', value, confidence: 1, collectedAt: date }
}

const multiSourceEvidence: Evidence[] = [
  makeEvidence('amp-1', 'amplitude', -18, 0),
  makeEvidence('gplay-1', 'google_play', 27, 5),
  makeEvidence('gh-1', 'github', 'checkout.ts changed', 3),
]

const validCandidate: CorrelationCandidate = {
  id: 'cross-source:test',
  evidenceIds: ['amp-1', 'gplay-1', 'gh-1'],
  sourceTypes: ['amplitude', 'google_play', 'github'],
  score: 0.73,
  reason: 'Signals from 3 independent sources overlap within the same time window.',
  ruleId: 'cross-source-correlation',
  createdAt: new Date(),
}

describe('CorrelationFindingBuilder', () => {
  const builder = new CorrelationFindingBuilder()

  describe('valid candidate', () => {
    it('returns a finding and explanation', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      expect('finding' in result).toBe(true)
      expect('explanation' in result).toBe(true)
    })

    it('finding has correlationId matching candidate id', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('finding' in result)) throw new Error('Expected finding')
      expect(result.finding.correlationId).toBe(validCandidate.id)
    })

    it('finding has evidenceIds', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('finding' in result)) throw new Error('Expected finding')
      expect(result.finding.evidenceIds).toContain('amp-1')
      expect(result.finding.evidenceIds).toContain('gplay-1')
      expect(result.finding.evidenceIds).toContain('gh-1')
    })

    it('finding has workspaceId', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('finding' in result)) throw new Error('Expected finding')
      expect(result.finding.workspaceId).toBe(WORKSPACE_ID)
    })

    it('finding description does not claim causation', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('finding' in result)) throw new Error('Expected finding')
      expect(result.finding.description).not.toMatch(/caused|because of|due to/i)
    })

    it('explanation evidenceIds contains all evidence IDs', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('explanation' in result)) throw new Error('Expected explanation')
      expect(result.explanation.evidenceIds).toContain('amp-1')
      expect(result.explanation.evidenceIds).toContain('gplay-1')
      expect(result.explanation.evidenceIds).toContain('gh-1')
    })

    it('explanation includes applied rule', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('explanation' in result)) throw new Error('Expected explanation')
      expect(result.explanation.appliedRules).toContain('cross-source-correlation')
    })

    it('explanation insightIds is empty (Finding path)', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('explanation' in result)) throw new Error('Expected explanation')
      expect(result.explanation.insightIds).toEqual([])
    })

    it('explanation findingIds contains the finding id', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('explanation' in result)) throw new Error('Expected explanation')
      if (!('finding' in result)) throw new Error('Expected finding')
      expect(result.explanation.findingIds).toContain(result.finding.id)
    })

    it('finding evidenceIds match explanation evidenceIds', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('finding' in result)) throw new Error('Expected finding')
      if (!('explanation' in result)) throw new Error('Expected explanation')
      expect(result.finding.evidenceIds).toEqual(result.explanation.evidenceIds)
    })

    it('confidence reason distinguishes score from confidence', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('explanation' in result)) throw new Error('Expected explanation')
      expect(result.explanation.confidenceReason).toContain('Correlation score')
      expect(result.explanation.confidenceReason).toContain('Finding confidence')
    })

    it('finding has priority based on score', () => {
      const highScore = { ...validCandidate, score: 0.85 }
      const result = builder.build(highScore, multiSourceEvidence, WORKSPACE_ID)
      if (!('finding' in result)) throw new Error('Expected finding')
      expect(result.finding.priority).toBe('high')
    })

    it('finding has severity based on score', () => {
      const result = builder.build(validCandidate, multiSourceEvidence, WORKSPACE_ID)
      if (!('finding' in result)) throw new Error('Expected finding')
      expect(['high', 'medium', 'low', 'info']).toContain(result.finding.severity)
    })
  })

  describe('validation — rejected candidates', () => {
    it('rejects candidate with no evidence IDs', () => {
      const bad = { ...validCandidate, evidenceIds: [] }
      const result = builder.build(bad, multiSourceEvidence, WORKSPACE_ID)
      expect('valid' in result && result.valid === false).toBe(true)
    })

    it('rejects candidate with score > 1', () => {
      const bad = { ...validCandidate, score: 1.5 }
      const result = builder.build(bad, multiSourceEvidence, WORKSPACE_ID)
      expect('valid' in result && result.valid === false).toBe(true)
    })

    it('rejects candidate with score < 0', () => {
      const bad = { ...validCandidate, score: -0.1 }
      const result = builder.build(bad, multiSourceEvidence, WORKSPACE_ID)
      expect('valid' in result && result.valid === false).toBe(true)
    })

    it('rejects candidate with unknown evidence IDs', () => {
      const bad = { ...validCandidate, evidenceIds: ['amp-1', 'nonexistent-id'] }
      const result = builder.build(bad, multiSourceEvidence, WORKSPACE_ID)
      expect('valid' in result && result.valid === false).toBe(true)
      if ('valid' in result) expect(result.reason).toContain('not found')
    })

    it('rejects candidate where all evidence is from same source', () => {
      const singleSourceEvidence: Evidence[] = [
        makeEvidence('amp-1', 'amplitude', -18, 0),
        makeEvidence('amp-2', 'amplitude', -5, 1),
      ]
      const bad = {
        ...validCandidate,
        evidenceIds: ['amp-1', 'amp-2'],
        sourceTypes: ['amplitude' as const, 'amplitude' as const],
      }
      const result = builder.build(bad, singleSourceEvidence, WORKSPACE_ID)
      expect('valid' in result && result.valid === false).toBe(true)
    })
  })

  describe('end-to-end: Correlation Engine → Finding', () => {
    it('produces a traceable finding from 3-source evidence', async () => {
      const { CorrelationEngine } = await import('../../CorrelationEngine')
      const engine = new CorrelationEngine()

      const evidence: Evidence[] = [
        makeEvidence('amp-checkout', 'amplitude', -18, 0),
        makeEvidence('gplay-checkout', 'google_play', 27, 5),
        makeEvidence('gh-checkout', 'github', 'checkout.ts modified', 3),
      ]

      const correlationResult = engine.evaluate(evidence)
      expect(correlationResult.candidates.length).toBeGreaterThan(0)

      const topCandidate = correlationResult.candidates[0]
      const buildResult = builder.build(topCandidate, evidence, WORKSPACE_ID)

      expect('finding' in buildResult).toBe(true)
      if (!('finding' in buildResult)) throw new Error('Expected finding')

      const { finding, explanation } = buildResult

      expect(finding.correlationId).toBe(topCandidate.id)
      expect(finding.workspaceId).toBe(WORKSPACE_ID)
      expect(finding.evidenceIds.length).toBeGreaterThan(0)
      expect(explanation.evidenceIds.length).toBeGreaterThan(0)
      expect(finding.description).not.toMatch(/caused|because of|due to/i)
    })
  })
})
