import { describe, it, expect } from 'vitest'
import { RecommendationEngine } from '../RecommendationEngine'
import { AddTestingStrategy } from '../strategies/AddTestingStrategy'
import { AddCIStrategy } from '../strategies/AddCIStrategy'
import { AddTypeScriptStrategy } from '../strategies/AddTypeScriptStrategy'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { Insight } from '../../../domain'

const WORKSPACE_ID = createWorkspaceId('ws-engine-test')

function makeInsight(id: string, tags: string[]): Insight {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    title: `Insight ${id}`,
    description: 'Test insight',
    confidence: 1,
    severity: 'high',
    source: 'github',
    evidenceIds: [],
    tags,
    createdAt: new Date(),
  }
}

describe('RecommendationEngine', () => {
  const engine = new RecommendationEngine()
    .register(new AddTestingStrategy())
    .register(new AddCIStrategy())
    .register(new AddTypeScriptStrategy())

  it('generates recommendation for matching insight', () => {
    const insight = makeInsight('insight-1', ['no-tests'])
    const recommendations = engine.generate([insight], WORKSPACE_ID)
    expect(recommendations.length).toBe(1)
    expect(recommendations[0].title).toContain('test')
  })

  it('generates recommendations for multiple matching insights', () => {
    const insights = [
      makeInsight('i1', ['no-tests']),
      makeInsight('i2', ['no-ci']),
      makeInsight('i3', ['no-typescript']),
    ]
    const recommendations = engine.generate(insights, WORKSPACE_ID)
    expect(recommendations.length).toBe(3)
  })

  it('returns empty array when no insight matches any strategy', () => {
    const insight = makeInsight('i1', ['unknown-tag'])
    const recommendations = engine.generate([insight], WORKSPACE_ID)
    expect(recommendations).toEqual([])
  })

  it('returns empty array for empty insights', () => {
    const recommendations = engine.generate([], WORKSPACE_ID)
    expect(recommendations).toEqual([])
  })

  it('all recommendations have origin insight', () => {
    const insights = [makeInsight('i1', ['no-tests']), makeInsight('i2', ['no-ci'])]
    const recommendations = engine.generate(insights, WORKSPACE_ID)
    for (const rec of recommendations) {
      expect(rec.origin).toBe('insight')
    }
  })

  it('all recommendations have workspaceId', () => {
    const insight = makeInsight('i1', ['no-tests'])
    const recommendations = engine.generate([insight], WORKSPACE_ID)
    for (const rec of recommendations) {
      expect(rec.workspaceId).toBe(WORKSPACE_ID)
    }
  })

  it('all recommendations have rationale', () => {
    const insight = makeInsight('i1', ['no-tests'])
    const recommendations = engine.generate([insight], WORKSPACE_ID)
    for (const rec of recommendations) {
      expect(rec.rationale.length).toBeGreaterThan(0)
    }
  })

  it('all recommendations have impact', () => {
    const insight = makeInsight('i1', ['no-tests'])
    const recommendations = engine.generate([insight], WORKSPACE_ID)
    for (const rec of recommendations) {
      expect(rec.impact.length).toBeGreaterThan(0)
    }
  })
})
