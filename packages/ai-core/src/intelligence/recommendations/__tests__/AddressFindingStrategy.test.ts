import { describe, it, expect } from 'vitest'
import { AddressFindingStrategy } from '../strategies/AddressFindingStrategy'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { Finding, Insight } from '../../../domain'
import type { RecommendationInput } from '../RecommendationInput'

const WORKSPACE_ID = createWorkspaceId('ws-finding-strategy-test')

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-1',
    workspaceId: WORKSPACE_ID,
    type: 'bug',
    title: 'Checkout reliability is deteriorating',
    description: 'Multiple independent sources show checkout failures increasing.',
    priority: 'high',
    severity: 'high',
    evidenceIds: ['amp-1', 'gplay-1'],
    relatedInsights: ['insight-1'],
    correlationId: 'cross-source:test',
    createdAt: new Date(),
    ...overrides,
  }
}

function makeInsight(): Insight {
  return {
    id: 'insight-1',
    workspaceId: WORKSPACE_ID,
    title: 'Checkout failures increasing',
    description: 'Amplitude shows checkout drop-off.',
    confidence: 0.9,
    severity: 'high',
    source: 'amplitude',
    evidenceIds: ['amp-1'],
    tags: ['cross-source'],
    createdAt: new Date(),
  }
}

function findingInput(finding: Finding): RecommendationInput {
  return { workspaceId: WORKSPACE_ID, finding }
}

function insightInput(insight: Insight): RecommendationInput {
  return { workspaceId: WORKSPACE_ID, insight }
}

describe('AddressFindingStrategy', () => {
  const strategy = new AddressFindingStrategy()

  it('has correct id', () => {
    expect(strategy.id).toBe('address-finding')
  })

  it('has supportedOrigins finding', () => {
    expect(strategy.supportedOrigins).toEqual(['finding'])
  })

  it('canHandle finding input', () => {
    expect(strategy.canHandle(findingInput(makeFinding()))).toBe(true)
  })

  it('rejects input without finding', () => {
    expect(strategy.canHandle({ workspaceId: WORKSPACE_ID })).toBe(false)
  })

  it('rejects insight-only input', () => {
    expect(strategy.canHandle(insightInput(makeInsight()))).toBe(false)
  })

  it('returns recommendation with origin finding', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.origin).toBe('finding')
  })

  it('returns recommendation with correct deduplicationKey', () => {
    const rec = strategy.recommend(findingInput(makeFinding({ id: 'f42' })))
    expect(rec.deduplicationKey).toBe('address-finding:finding:f42')
  })

  it('returns recommendation with correct findingIds', () => {
    const rec = strategy.recommend(findingInput(makeFinding({ id: 'f42' })))
    expect(rec.findingIds).toEqual(['f42'])
  })

  it('returns recommendation with empty insightIds', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.insightIds).toEqual([])
  })

  it('returns recommendation with title derived from finding', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.title).toContain('Checkout reliability is deteriorating')
  })

  it('returns recommendation with rationale from finding description', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.rationale).toBe('Multiple independent sources show checkout failures increasing.')
  })

  it('returns recommendation with impact derived from finding type and severity', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.impact).toContain('bug')
    expect(rec.impact).toContain('high')
  })

  it('returns recommendation with priority from finding', () => {
    const rec = strategy.recommend(findingInput(makeFinding({ priority: 'critical' })))
    expect(rec.priority).toBe('critical')
  })

  it('returns recommendation with medium effort', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.effort).toBe('medium')
  })

  it('returns recommendation with confidence 0.8', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.confidence).toBe(0.8)
  })

  it('returns recommendation with workspaceId', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.workspaceId).toBe(WORKSPACE_ID)
  })

  it('returns recommendation with id', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.id).toBeDefined()
  })

  it('returns recommendation with createdAt', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.createdAt).toBeInstanceOf(Date)
  })

  it('returns recommendation with empty proposedActions', () => {
    const rec = strategy.recommend(findingInput(makeFinding()))
    expect(rec.proposedActions).toEqual([])
  })

  it('handles different finding types', () => {
    for (const type of ['bug', 'opportunity', 'risk', 'growth'] as const) {
      const rec = strategy.recommend(findingInput(makeFinding({ type })))
      expect(rec.impact).toContain(type)
    }
  })

  it('handles different finding severities', () => {
    for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
      const rec = strategy.recommend(findingInput(makeFinding({ severity })))
      expect(rec.impact).toContain(severity)
    }
  })

  it('preserves finding id in provenance chain', () => {
    const finding = makeFinding({ id: 'finding-abc-123' })
    const rec = strategy.recommend(findingInput(finding))
    expect(rec.findingIds).toEqual(['finding-abc-123'])
    expect(rec.insightIds).toEqual([])
    expect(rec.origin).toBe('finding')
  })
})
