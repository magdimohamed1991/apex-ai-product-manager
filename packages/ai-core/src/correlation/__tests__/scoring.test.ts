import { describe, it, expect } from 'vitest'
import { scoreCorrelation, hasTemporalOverlap } from '../scoring'
import type { Evidence } from '@apex/analysis'

function makeEvidence(source: Evidence['source'], daysAgo = 0): Evidence {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return {
    id: `${source}-${daysAgo}`,
    type: 'testing',
    source,
    key: 'signal',
    value: -10,
    confidence: 1,
    collectedAt: date,
  }
}

describe('scoreCorrelation', () => {
  it('returns 0 for single source', () => {
    const score = scoreCorrelation(['amplitude'], [makeEvidence('amplitude')], 1)
    expect(score).toBe(0)
  })

  it('returns higher score for more sources', () => {
    const two = scoreCorrelation(
      ['amplitude', 'google-play'],
      [makeEvidence('amplitude'), makeEvidence('google-play')],
      0.8
    )
    const three = scoreCorrelation(
      ['amplitude', 'google-play', 'github'],
      [makeEvidence('amplitude'), makeEvidence('google-play'), makeEvidence('github')],
      0.8
    )
    expect(three).toBeGreaterThan(two)
  })

  it('score is between 0 and 1', () => {
    const score = scoreCorrelation(
      ['amplitude', 'google-play', 'github'],
      [makeEvidence('amplitude'), makeEvidence('google-play'), makeEvidence('github')],
      0.9
    )
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it('lower confidence evidence produces lower score', () => {
    const highConf: Evidence = { ...makeEvidence('amplitude'), confidence: 1 }
    const lowConf: Evidence = { ...makeEvidence('google-play'), confidence: 0.2 }
    const highConf2: Evidence = { ...makeEvidence('amplitude'), confidence: 1 }
    const highConf3: Evidence = { ...makeEvidence('google-play'), confidence: 1 }

    const lowScore = scoreCorrelation(['amplitude', 'google-play'], [highConf, lowConf], 0.8)
    const highScore = scoreCorrelation(['amplitude', 'google-play'], [highConf2, highConf3], 0.8)
    expect(lowScore).toBeLessThan(highScore)
  })

  it('is deterministic for same inputs', () => {
    const e = [makeEvidence('amplitude'), makeEvidence('google-play')]
    const s1 = scoreCorrelation(['amplitude', 'google-play'], e, 0.7)
    const s2 = scoreCorrelation(['amplitude', 'google-play'], e, 0.7)
    expect(s1).toBe(s2)
  })
})

describe('hasTemporalOverlap', () => {
  it('returns true for evidence within 30 days', () => {
    const a = [makeEvidence('amplitude', 0)]
    const b = [makeEvidence('google-play', 15)]
    expect(hasTemporalOverlap(a, b)).toBe(true)
  })

  it('returns false for evidence outside 30 days', () => {
    const a = [makeEvidence('amplitude', 0)]
    const b = [makeEvidence('google-play', 60)]
    expect(hasTemporalOverlap(a, b)).toBe(false)
  })

  it('respects custom window', () => {
    const a = [makeEvidence('amplitude', 0)]
    const b = [makeEvidence('google-play', 10)]
    expect(hasTemporalOverlap(a, b, 5)).toBe(false)
    expect(hasTemporalOverlap(a, b, 15)).toBe(true)
  })

  it('returns false for empty arrays', () => {
    expect(hasTemporalOverlap([], [makeEvidence('amplitude')])).toBe(false)
  })
})
