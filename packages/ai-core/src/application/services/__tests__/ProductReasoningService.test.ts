import { describe, it, expect, beforeEach } from 'vitest'
import { ProductReasoningService } from '../ProductReasoningService'
import type { LLMProvider, LLMResponse } from '../../../providers/LLMProvider'
import type { ProductRepository } from '../../../domain/repositories/ProductRepository'
import type { RichRecommendation, AIProductReasoning } from '../../../domain/entities'
import { createWorkspaceId } from '../../../domain/value-objects'

function makeProvider(content: string | null, fail = false): LLMProvider {
  return {
    name: 'mock',
    model: 'mock',
    async complete(): Promise<LLMResponse> {
      if (fail) throw new Error('provider down')
      return {
        content: content ?? '',
        model: 'mock',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        durationMs: 0,
      }
    },
  }
}

function makeRepo(store: AIProductReasoning[] = []): ProductRepository {
  return {
    async saveAIProductReasoning(r: AIProductReasoning) {
      store.push(r)
    },
  } as unknown as ProductRepository
}

function makeRec(overrides: Partial<RichRecommendation> = {}): RichRecommendation {
  return {
    id: 'rec-1',
    workspaceId: createWorkspaceId('ws-1'),
    origin: 'insight',
    deduplicationKey: 'k-1',
    title: 'Add automated tests',
    rationale: 'No tests detected',
    impact: 'Reduces regression risk',
    effort: 'medium',
    priority: 'high',
    confidence: 0.9,
    insightIds: ['i-1'],
    findingIds: [],
    proposedActions: [{ id: 'pa-1', title: 'Add Vitest', description: 'Configure Vitest' }],
    createdAt: new Date(),
    pmCategory: 'CRITICAL_PRODUCT_RISK',
    assessment: {
      severity: 'high',
      businessImpact: 'high',
      userImpact: 'high',
      deliveryRisk: 'high',
      operationalRisk: 'high',
      effort: 'medium',
      confidence: 0.9,
    },
    priorityScore: 7.5,
    expectedOutcome: 'Tests will run on every PR',
    rankingReason: '',
    ...overrides,
  }
}

describe('ProductReasoningService (Milestone I - Production Hardening)', () => {
  let saved: AIProductReasoning[]
  let service: ProductReasoningService

  beforeEach(() => {
    saved = []
  })

  it('returns "unavailable" reasoning when the provider throws', async () => {
    service = new ProductReasoningService(makeRepo(saved), makeProvider(null, true))
    const r = await service.generateReasoning(makeRec())
    expect(r.unavailable).toBe(true)
    expect(r.failureReason).toBe('provider_error')
    expect(r.knowns).toEqual([])
    expect(r.confidence).toBe(0)
  })

  it('returns "unavailable" reasoning when output is not JSON', async () => {
    service = new ProductReasoningService(makeRepo(saved), makeProvider('not json {'))
    const r = await service.generateReasoning(makeRec())
    expect(r.unavailable).toBe(true)
    expect(r.failureReason).toBe('invalid_json')
  })

  it('returns "unavailable" reasoning when schema validation fails (missing required field)', async () => {
    const content = JSON.stringify({
      // missing rationale, impactExplanation, recommendedDecision
      tradeoffs: ['x'],
      knowns: ['a'],
      inferences: ['b'],
      unknowns: ['c'],
      clarifyingQuestions: [],
      confidence: 0.5,
      alternatives: [{ label: 'X', effort: 'low', impact: 'high', description: '' }],
    })
    service = new ProductReasoningService(makeRepo(saved), makeProvider(content))
    const r = await service.generateReasoning(makeRec())
    expect(r.unavailable).toBe(true)
    expect(r.failureReason).toBe('schema_violation')
  })

  it('rejects out-of-range confidence', async () => {
    const content = JSON.stringify({
      rationale: 'r',
      impactExplanation: 'i',
      recommendedDecision: 'd',
      tradeoffs: ['t'],
      knowns: ['a'],
      inferences: ['b'],
      unknowns: ['c'],
      clarifyingQuestions: [],
      confidence: 1.5,
      alternatives: [{ label: 'X', effort: 'low', impact: 'high', description: '' }],
    })
    service = new ProductReasoningService(makeRepo(saved), makeProvider(content))
    const r = await service.generateReasoning(makeRec())
    expect(r.unavailable).toBe(true)
    expect(r.failureReason).toBe('schema_violation')
  })

  it('rejects knowns that violate grounding rules (legacy fabricated strings)', async () => {
    const content = JSON.stringify({
      rationale: 'r',
      impactExplanation: 'i',
      recommendedDecision: 'd',
      tradeoffs: ['t'],
      knowns: ['tsconfig contains disabled parameters', 'CI workflow lacks validation'],
      inferences: ['b'],
      unknowns: ['c'],
      clarifyingQuestions: [],
      confidence: 0.7,
      alternatives: [{ label: 'X', effort: 'low', impact: 'high', description: '' }],
    })
    service = new ProductReasoningService(makeRepo(saved), makeProvider(content))
    const r = await service.generateReasoning(makeRec())
    // No grounded knowns survive -> the entire record is rejected
    expect(r.unavailable).toBe(true)
    expect(r.failureReason).toBe('grounding_violation')
  })

  it('accepts grounded knowns that reference the recommendation title or category', async () => {
    const content = JSON.stringify({
      rationale: 'r',
      impactExplanation: 'i',
      recommendedDecision: 'd',
      tradeoffs: ['t'],
      knowns: [
        'The Add automated tests recommendation has been observed',
        'No working automated testing pipeline is in place',
      ],
      inferences: ['b'],
      unknowns: ['c'],
      clarifyingQuestions: [],
      confidence: 0.8,
      alternatives: [{ label: 'X', effort: 'low', impact: 'high', description: '' }],
    })
    service = new ProductReasoningService(makeRepo(saved), makeProvider(content))
    const r = await service.generateReasoning(makeRec())
    expect(r.unavailable).toBeUndefined()
    expect(r.knowns.length).toBe(2)
    expect(saved.length).toBe(1)
  })

  it('persists a successful reasoning record with a stable contextHash', async () => {
    const content = JSON.stringify({
      rationale: 'r',
      impactExplanation: 'i',
      recommendedDecision: 'd',
      tradeoffs: ['t'],
      knowns: ['Add automated tests evidence is in scope'],
      inferences: ['b'],
      unknowns: ['c'],
      clarifyingQuestions: ['how often?'],
      confidence: 0.6,
      alternatives: [{ label: 'X', effort: 'low', impact: 'high', description: '' }],
    })
    service = new ProductReasoningService(makeRepo(saved), makeProvider(content))
    const r = await service.generateReasoning(makeRec())
    expect(r.contextHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.version).toBe('h4-v2')
  })
})
