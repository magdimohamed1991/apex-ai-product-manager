import { describe, it, expect } from 'vitest'
import { RecommendationEngine } from '../RecommendationEngine'
import { AddTestingStrategy } from '../strategies/AddTestingStrategy'
import { AddCIStrategy } from '../strategies/AddCIStrategy'
import { AddTypeScriptStrategy } from '../strategies/AddTypeScriptStrategy'
import { createWorkspaceId } from '../../../domain/value-objects'
import { createRecommendation } from '../../../domain/entities/Recommendation'
import type { Insight, Finding, Recommendation } from '../../../domain'
import type { RecommendationStrategy } from '../RecommendationStrategy'
import type { RecommendationInput } from '../RecommendationInput'

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

function makeFinding(id: string): Finding {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    type: 'bug',
    title: `Finding ${id}`,
    description: 'Test finding',
    priority: 'high',
    severity: 'high',
    evidenceIds: [],
    correlationId: `cross-source:${id}`,
    createdAt: new Date(),
  }
}

function dummyFindingStrategy(): RecommendationStrategy {
  return {
    id: 'dummy-finding',
    supportedOrigins: ['finding'],
    canHandle(input: RecommendationInput): boolean {
      return input.finding !== undefined
    },
    recommend(input: RecommendationInput): Recommendation {
      return {
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        origin: 'finding',
        deduplicationKey: `dummy-finding:finding:${input.finding!.id}`,
        title: `Dummy recommendation for ${input.finding!.id}`,
        rationale: 'Dummy',
        impact: 'Dummy',
        effort: 'low',
        priority: 'medium',
        confidence: 0.5,
        insightIds: [],
        findingIds: [input.finding!.id],
        proposedActions: [],
        createdAt: new Date(),
      }
    },
  }
}

describe('RecommendationEngine', () => {
  const engine = new RecommendationEngine()
    .register(new AddTestingStrategy())
    .register(new AddCIStrategy())
    .register(new AddTypeScriptStrategy())

  describe('Insight-only input', () => {
    it('generates recommendation for matching insight', () => {
      const insight = makeInsight('insight-1', ['no-tests'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      expect(recommendations.length).toBe(1)
      expect(recommendations[0].title).toContain('test')
    })

    it('generates recommendations for multiple matching insights', () => {
      const insights = [
        makeInsight('i1', ['no-tests']),
        makeInsight('i2', ['no-ci']),
        makeInsight('i3', ['no-typescript']),
      ]
      const recommendations = engine.generate(insights, [], WORKSPACE_ID)
      expect(recommendations.length).toBe(3)
    })

    it('returns empty array when no insight matches any strategy', () => {
      const insight = makeInsight('i1', ['unknown-tag'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      expect(recommendations).toEqual([])
    })

    it('all recommendations have origin insight', () => {
      const insights = [makeInsight('i1', ['no-tests']), makeInsight('i2', ['no-ci'])]
      const recommendations = engine.generate(insights, [], WORKSPACE_ID)
      for (const rec of recommendations) {
        expect(rec.origin).toBe('insight')
      }
    })

    it('all recommendations have workspaceId', () => {
      const insight = makeInsight('i1', ['no-tests'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      for (const rec of recommendations) {
        expect(rec.workspaceId).toBe(WORKSPACE_ID)
      }
    })

    it('all recommendations have rationale', () => {
      const insight = makeInsight('i1', ['no-tests'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      for (const rec of recommendations) {
        expect(rec.rationale.length).toBeGreaterThan(0)
      }
    })

    it('all recommendations have impact', () => {
      const insight = makeInsight('i1', ['no-tests'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      for (const rec of recommendations) {
        expect(rec.impact.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Finding-only input', () => {
    it('returns empty array with no finding strategies', () => {
      const finding = makeFinding('f1')
      const recommendations = engine.generate([], [finding], WORKSPACE_ID)
      expect(recommendations).toEqual([])
    })

    it('returns empty array for multiple findings with no finding strategies', () => {
      const findings = [makeFinding('f1'), makeFinding('f2')]
      const recommendations = engine.generate([], findings, WORKSPACE_ID)
      expect(recommendations).toEqual([])
    })
  })

  describe('Mixed Insight + Finding input', () => {
    it('returns only insight recommendations when no finding strategies exist', () => {
      const insights = [makeInsight('i1', ['no-tests'])]
      const findings = [makeFinding('f1')]
      const recommendations = engine.generate(insights, findings, WORKSPACE_ID)
      expect(recommendations.length).toBe(1)
      expect(recommendations[0].origin).toBe('insight')
    })
  })

  describe('Empty arrays', () => {
    it('returns empty array for empty insights and findings', () => {
      const recommendations = engine.generate([], [], WORKSPACE_ID)
      expect(recommendations).toEqual([])
    })
  })

  describe('deduplication', () => {
    it('deduplicates recommendations with same deduplicationKey', () => {
      const insight = makeInsight('i1', ['no-tests'])
      const rec1 = engine.generate([insight], [], WORKSPACE_ID)
      const rec2 = engine.generate([insight], [], WORKSPACE_ID)
      expect(rec1.length).toBe(1)
      expect(rec2.length).toBe(1)
      expect(rec1[0].deduplicationKey).toBe(rec2[0].deduplicationKey)
    })

    it('allows different insights to produce different recommendations', () => {
      const insights = [makeInsight('i1', ['no-tests']), makeInsight('i2', ['no-ci'])]
      const recommendations = engine.generate(insights, [], WORKSPACE_ID)
      const keys = recommendations.map((r) => r.deduplicationKey)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('deduplicates when two strategies produce same key for same entity', () => {
      const duplicateKeyStrategy: RecommendationStrategy = {
        id: 'duplicate-test',
        supportedOrigins: ['insight'],
        canHandle: (input) => input.insight?.tags.includes('no-tests') ?? false,
        recommend: (input) => ({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          origin: 'insight',
          deduplicationKey: `add-testing:insight:${input.insight!.id}`,
          title: 'Duplicate recommendation',
          rationale: 'Same key as AddTestingStrategy',
          impact: 'test',
          effort: 'low',
          priority: 'medium',
          confidence: 0.5,
          insightIds: [input.insight!.id],
          findingIds: [],
          proposedActions: [],
          createdAt: new Date(),
        }),
      }

      const engineWithDup = new RecommendationEngine()
        .register(new AddTestingStrategy())
        .register(duplicateKeyStrategy)

      const insight = makeInsight('i1', ['no-tests'])
      const recommendations = engineWithDup.generate([insight], [], WORKSPACE_ID)
      expect(recommendations.length).toBe(1)
      expect(recommendations[0].title).toBe('Introduce automated testing')
    })
  })

  describe('supportedOrigins filtering', () => {
    it('insight strategies are not called for findings', () => {
      const finding = makeFinding('f1')
      const recommendations = engine.generate([], [finding], WORKSPACE_ID)
      expect(recommendations).toEqual([])
    })

    it('finding strategies are eligible when supportedOrigins contains finding', () => {
      const engineWithFinding = new RecommendationEngine()
        .register(new AddTestingStrategy())
        .register(dummyFindingStrategy())

      const finding = makeFinding('f1')
      const recommendations = engineWithFinding.generate([], [finding], WORKSPACE_ID)
      expect(recommendations.length).toBe(1)
      expect(recommendations[0].origin).toBe('finding')
      expect(recommendations[0].findingIds).toEqual(['f1'])
      expect(recommendations[0].insightIds).toEqual([])
    })

    it('finding strategies do not consume insight inputs', () => {
      const engineWithFinding = new RecommendationEngine()
        .register(new AddTestingStrategy())
        .register(dummyFindingStrategy())

      const insight = makeInsight('i1', ['no-tests'])
      const recommendations = engineWithFinding.generate([insight], [], WORKSPACE_ID)
      expect(recommendations.length).toBe(1)
      expect(recommendations[0].origin).toBe('insight')
    })

    it('mixed input produces correct origins', () => {
      const engineWithFinding = new RecommendationEngine()
        .register(new AddTestingStrategy())
        .register(new AddCIStrategy())
        .register(dummyFindingStrategy())

      const insights = [makeInsight('i1', ['no-tests'])]
      const findings = [makeFinding('f1')]
      const recommendations = engineWithFinding.generate(insights, findings, WORKSPACE_ID)
      expect(recommendations.length).toBe(2)

      const insightRecs = recommendations.filter((r) => r.origin === 'insight')
      const findingRecs = recommendations.filter((r) => r.origin === 'finding')
      expect(insightRecs.length).toBe(1)
      expect(findingRecs.length).toBe(1)
    })
  })

  describe('multiple matching strategies', () => {
    it('multiple strategies can match the same insight', () => {
      const multiTagInsight = makeInsight('i1', ['no-tests', 'no-ci'])
      const recommendations = engine.generate([multiTagInsight], [], WORKSPACE_ID)
      expect(recommendations.length).toBe(2)
    })
  })

  describe('no matching strategies', () => {
    it('returns empty when no strategy matches', () => {
      const insight = makeInsight('i1', ['unrelated-tag'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      expect(recommendations).toEqual([])
    })
  })

  describe('provenance', () => {
    it('insight recommendations have correct insightIds', () => {
      const insight = makeInsight('i1', ['no-tests'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      expect(recommendations[0].insightIds).toEqual(['i1'])
    })

    it('insight recommendations have empty findingIds', () => {
      const insight = makeInsight('i1', ['no-tests'])
      const recommendations = engine.generate([insight], [], WORKSPACE_ID)
      expect(recommendations[0].findingIds).toEqual([])
    })
  })

  describe('createRecommendation factory validation (Item 3 & Item 9)', () => {
    const baseInput = {
      workspaceId: WORKSPACE_ID,
      deduplicationKey: 'test-key',
      title: 'Test Title',
      rationale: 'Test Rationale',
      impact: 'Test Impact',
      effort: 'low' as const,
      priority: 'high' as const,
      confidence: 0.9,
      insightIds: [],
      findingIds: [],
      proposedActions: [],
    }

    it('successfully creates an insight-origin recommendation', () => {
      const rec = createRecommendation({
        ...baseInput,
        origin: 'insight',
        insightIds: ['insight-123'],
      })
      expect(rec.origin).toBe('insight')
      expect(rec.insightIds).toEqual(['insight-123'])
      expect(rec.findingIds).toEqual([])
    })

    it('successfully creates a finding-origin recommendation', () => {
      const rec = createRecommendation({
        ...baseInput,
        origin: 'finding',
        findingIds: ['finding-123'],
      })
      expect(rec.origin).toBe('finding')
      expect(rec.findingIds).toEqual(['finding-123'])
      expect(rec.insightIds).toEqual([])
    })

    it('throws if insight origin is missing insightIds', () => {
      expect(() =>
        createRecommendation({
          ...baseInput,
          origin: 'insight',
          insightIds: [],
        })
      ).toThrow(/Insight origin requires insightIds/)
    })

    it('throws if insight origin contains findingIds', () => {
      expect(() =>
        createRecommendation({
          ...baseInput,
          origin: 'insight',
          insightIds: ['insight-1'],
          findingIds: ['finding-1'],
        })
      ).toThrow(/Insight origin rejects findingIds/)
    })

    it('throws if finding origin is missing findingIds', () => {
      expect(() =>
        createRecommendation({
          ...baseInput,
          origin: 'finding',
          findingIds: [],
        })
      ).toThrow(/Finding origin requires findingIds/)
    })

    it('throws if finding origin contains insightIds', () => {
      expect(() =>
        createRecommendation({
          ...baseInput,
          origin: 'finding',
          findingIds: ['finding-1'],
          insightIds: ['insight-1'],
        })
      ).toThrow(/Finding origin rejects insightIds/)
    })

    it('throws if confidence is out of bounds (< 0)', () => {
      expect(() =>
        createRecommendation({
          ...baseInput,
          origin: 'insight',
          insightIds: ['insight-1'],
          confidence: -0.1,
        })
      ).toThrow(/Confidence must be a number between 0 and 1/)
    })

    it('throws if confidence is out of bounds (> 1)', () => {
      expect(() =>
        createRecommendation({
          ...baseInput,
          origin: 'insight',
          insightIds: ['insight-1'],
          confidence: 1.1,
        })
      ).toThrow(/Confidence must be a number between 0 and 1/)
    })
  })
})
