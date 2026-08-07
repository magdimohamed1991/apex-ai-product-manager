import { describe, it, expect } from 'vitest'
import { AddTestingStrategy } from '../strategies/AddTestingStrategy'
import { AddCIStrategy } from '../strategies/AddCIStrategy'
import { AddTypeScriptStrategy } from '../strategies/AddTypeScriptStrategy'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { Insight } from '../../../domain'

const WORKSPACE_ID = createWorkspaceId('ws-strategies-test')

function makeInsight(tags: string[], id = 'insight-1'): Insight {
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

describe('AddTestingStrategy', () => {
  const strategy = new AddTestingStrategy()

  it('has correct id', () => {
    expect(strategy.id).toBe('add-testing')
  })

  it('canHandle insight with no-tests tag', () => {
    expect(strategy.canHandle(makeInsight(['no-tests']))).toBe(true)
  })

  it('rejects insight without no-tests tag', () => {
    expect(strategy.canHandle(makeInsight(['no-ci']))).toBe(false)
  })

  it('returns recommendation with origin insight', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.origin).toBe('insight')
  })

  it('returns recommendation with valid rationale', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.rationale.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid impact', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.impact.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid effort', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(['low', 'medium', 'high']).toContain(rec.effort)
  })

  it('returns recommendation with valid priority', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority)
  })

  it('returns recommendation with confidence between 0 and 1', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.confidence).toBeGreaterThanOrEqual(0)
    expect(rec.confidence).toBeLessThanOrEqual(1)
  })

  it('returns recommendation with insightIds array', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(Array.isArray(rec.insightIds)).toBe(true)
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with proposedActions array', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(Array.isArray(rec.proposedActions)).toBe(true)
  })

  it('returns recommendation with workspaceId', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.workspaceId).toBe(WORKSPACE_ID)
  })

  it('returns recommendation with title', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.title.length).toBeGreaterThan(0)
  })

  it('returns recommendation with id', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.id).toBeDefined()
  })

  it('returns recommendation with createdAt', () => {
    const rec = strategy.recommend(makeInsight(['no-tests']), WORKSPACE_ID)
    expect(rec.createdAt).toBeInstanceOf(Date)
  })
})

describe('AddCIStrategy', () => {
  const strategy = new AddCIStrategy()

  it('has correct id', () => {
    expect(strategy.id).toBe('add-ci')
  })

  it('canHandle insight with no-ci tag', () => {
    expect(strategy.canHandle(makeInsight(['no-ci']))).toBe(true)
  })

  it('rejects insight without no-ci tag', () => {
    expect(strategy.canHandle(makeInsight(['no-tests']))).toBe(false)
  })

  it('returns recommendation with origin insight', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(rec.origin).toBe('insight')
  })

  it('returns recommendation with valid rationale', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(rec.rationale.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid impact', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(rec.impact.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid effort', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(['low', 'medium', 'high']).toContain(rec.effort)
  })

  it('returns recommendation with valid priority', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority)
  })

  it('returns recommendation with confidence between 0 and 1', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(rec.confidence).toBeGreaterThanOrEqual(0)
    expect(rec.confidence).toBeLessThanOrEqual(1)
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with proposedActions array', () => {
    const rec = strategy.recommend(makeInsight(['no-ci']), WORKSPACE_ID)
    expect(Array.isArray(rec.proposedActions)).toBe(true)
  })
})

describe('AddTypeScriptStrategy', () => {
  const strategy = new AddTypeScriptStrategy()

  it('has correct id', () => {
    expect(strategy.id).toBe('add-typescript')
  })

  it('canHandle insight with no-typescript tag', () => {
    expect(strategy.canHandle(makeInsight(['no-typescript']))).toBe(true)
  })

  it('rejects insight without no-typescript tag', () => {
    expect(strategy.canHandle(makeInsight(['no-tests']))).toBe(false)
  })

  it('returns recommendation with origin insight', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(rec.origin).toBe('insight')
  })

  it('returns recommendation with valid rationale', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(rec.rationale.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid impact', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(rec.impact.length).toBeGreaterThan(0)
  })

  it('returns recommendation with valid effort', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(['low', 'medium', 'high']).toContain(rec.effort)
  })

  it('returns recommendation with valid priority', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority)
  })

  it('returns recommendation with confidence between 0 and 1', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(rec.confidence).toBeGreaterThanOrEqual(0)
    expect(rec.confidence).toBeLessThanOrEqual(1)
  })

  it('returns recommendation with empty findingIds', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(rec.findingIds).toEqual([])
  })

  it('returns recommendation with proposedActions array', () => {
    const rec = strategy.recommend(makeInsight(['no-typescript']), WORKSPACE_ID)
    expect(Array.isArray(rec.proposedActions)).toBe(true)
  })
})
