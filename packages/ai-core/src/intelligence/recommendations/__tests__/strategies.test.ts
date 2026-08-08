import { describe, it, expect } from 'vitest'
import { AddTestingStrategy } from '../strategies/AddTestingStrategy'
import { AddCIStrategy } from '../strategies/AddCIStrategy'
import { AddTypeScriptStrategy } from '../strategies/AddTypeScriptStrategy'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { Insight, Finding } from '../../../domain'
import type { RecommendationInput } from '../RecommendationInput'

const WORKSPACE_ID = createWorkspaceId('ws-strategies-test')

function makeInsight(id: string, tags: string[]): Insight {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    title: 'Test insight',
    description: 'Test',
    confidence: 1,
    severity: 'high',
    source: 'github',
    evidenceIds: [],
    tags,
    createdAt: new Date(),
  }
}

function makeFinding(id: string): Finding {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    type: 'bug',
    title: 'Test finding',
    description: 'A finding',
    severity: 'high',
    priority: 'high',
    evidenceIds: [],
    correlationId: 'cross-source:test',
    relatedInsights: [],
    createdAt: new Date(),
  }
}

function insightInput(insight: Insight): RecommendationInput {
  return { workspaceId: WORKSPACE_ID, insight }
}

function findingInput(finding: Finding): RecommendationInput {
  return { workspaceId: WORKSPACE_ID, finding }
}

describe('AddTestingStrategy', () => {
  const strategy = new AddTestingStrategy()

  it('has correct id', () => {
    expect(strategy.id).toBe('add-testing')
  })

  it('has supportedOrigins insight', () => {
    expect(strategy.supportedOrigins).toEqual(['insight'])
  })

  it('canHandle insight with no-tests tag', () => {
    expect(strategy.canHandle(insightInput(makeInsight('i1', ['no-tests'])))).toBe(true)
  })

  it('rejects insight without no-tests tag', () => {
    expect(strategy.canHandle(insightInput(makeInsight('i1', ['no-ci'])))).toBe(false)
  })

  it('rejects input without insight', () => {
    expect(strategy.canHandle({ workspaceId: WORKSPACE_ID })).toBe(false)
  })

  it('rejects finding-only input', () => {
    expect(strategy.canHandle(findingInput(makeFinding('f1')))).toBe(false)
  })

  it('returns recommendation with origin insight', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.origin).toBe('insight')
  })

  it('returns recommendation with correct deduplicationKey', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.deduplicationKey).toBe('add-testing:insight:i1')
  })

  it('returns recommendation with correct insightIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.insightIds).toEqual(['i1'])
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with valid rationale', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.rationale.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid impact', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.impact.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid effort', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(['low', 'medium', 'high']).toContain(rec.effort)
  })

  it('returns recommendation with valid priority', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority)
  })

  it('returns recommendation with confidence between 0 and 1', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.confidence).toBeGreaterThanOrEqual(0)
    expect(rec.confidence).toBeLessThanOrEqual(1)
  })

  it('returns recommendation with non-empty proposedActions', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.proposedActions.length).toBeGreaterThan(0)
  })

  it('returns recommendation with workspaceId', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.workspaceId).toBe(WORKSPACE_ID)
  })

  it('returns recommendation with title', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.title.length).toBeGreaterThan(0)
  })

  it('returns recommendation with id', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.id).toBeDefined()
  })

  it('returns recommendation with createdAt', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-tests'])))
    expect(rec.createdAt).toBeInstanceOf(Date)
  })
})

describe('AddCIStrategy', () => {
  const strategy = new AddCIStrategy()

  it('has correct id', () => {
    expect(strategy.id).toBe('add-ci')
  })

  it('has supportedOrigins insight', () => {
    expect(strategy.supportedOrigins).toEqual(['insight'])
  })

  it('canHandle insight with no-ci tag', () => {
    expect(strategy.canHandle(insightInput(makeInsight('i1', ['no-ci'])))).toBe(true)
  })

  it('rejects insight without no-ci tag', () => {
    expect(strategy.canHandle(insightInput(makeInsight('i1', ['no-tests'])))).toBe(false)
  })

  it('rejects input without insight', () => {
    expect(strategy.canHandle({ workspaceId: WORKSPACE_ID })).toBe(false)
  })

  it('rejects finding-only input', () => {
    expect(strategy.canHandle(findingInput(makeFinding('f1')))).toBe(false)
  })

  it('returns recommendation with origin insight', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.origin).toBe('insight')
  })

  it('returns recommendation with correct deduplicationKey', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.deduplicationKey).toBe('add-ci:insight:i1')
  })

  it('returns recommendation with correct insightIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.insightIds).toEqual(['i1'])
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with valid rationale', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.rationale.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid impact', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.impact.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid effort', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(['low', 'medium', 'high']).toContain(rec.effort)
  })

  it('returns recommendation with valid priority', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority)
  })

  it('returns recommendation with confidence between 0 and 1', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.confidence).toBeGreaterThanOrEqual(0)
    expect(rec.confidence).toBeLessThanOrEqual(1)
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with non-empty proposedActions', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-ci'])))
    expect(rec.proposedActions.length).toBeGreaterThan(0)
  })
})

describe('AddTypeScriptStrategy', () => {
  const strategy = new AddTypeScriptStrategy()

  it('has correct id', () => {
    expect(strategy.id).toBe('add-typescript')
  })

  it('has supportedOrigins insight', () => {
    expect(strategy.supportedOrigins).toEqual(['insight'])
  })

  it('canHandle insight with no-typescript tag', () => {
    expect(strategy.canHandle(insightInput(makeInsight('i1', ['no-typescript'])))).toBe(true)
  })

  it('rejects insight without no-typescript tag', () => {
    expect(strategy.canHandle(insightInput(makeInsight('i1', ['no-tests'])))).toBe(false)
  })

  it('rejects input without insight', () => {
    expect(strategy.canHandle({ workspaceId: WORKSPACE_ID })).toBe(false)
  })

  it('rejects finding-only input', () => {
    expect(strategy.canHandle(findingInput(makeFinding('f1')))).toBe(false)
  })

  it('returns recommendation with origin insight', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.origin).toBe('insight')
  })

  it('returns recommendation with correct deduplicationKey', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.deduplicationKey).toBe('add-typescript:insight:i1')
  })

  it('returns recommendation with correct insightIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.insightIds).toEqual(['i1'])
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with valid rationale', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.rationale.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid impact', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.impact.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid effort', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(['low', 'medium', 'high']).toContain(rec.effort)
  })

  it('returns recommendation with valid priority', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority)
  })

  it('returns recommendation with confidence between 0 and 1', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.confidence).toBeGreaterThanOrEqual(0)
    expect(rec.confidence).toBeLessThanOrEqual(1)
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with non-empty proposedActions', () => {
    const rec = strategy.recommend(insightInput(makeInsight('i1', ['no-typescript'])))
    expect(rec.proposedActions.length).toBeGreaterThan(0)
  })
})
