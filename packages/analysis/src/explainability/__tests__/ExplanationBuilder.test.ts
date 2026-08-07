import { describe, it, expect } from 'vitest'
import { ExplanationBuilder } from '../ExplanationBuilder'
import type { Insight } from '@apex/ai-core'
import type { Evidence } from '../../evidence'
import type { RuleResult } from '../../rules'

const WORKSPACE_ID = 'ws-test' as ReturnType<typeof import('@apex/ai-core').createWorkspaceId>

const mockEvidence: Evidence = {
  id: 'testing:hasTests',
  type: 'testing',
  source: 'github',
  key: 'hasTests',
  value: false,
  confidence: 1,
  collectedAt: new Date(),
}

const mockRuleResult: RuleResult = {
  ruleId: 'no-tests',
  matched: true,
  severity: 'high',
  priority: 'high',
  title: 'No automated tests detected',
  message: 'The repository has no test configuration.',
  evidenceIds: ['testing:hasTests'],
}

const mockInsight: Insight = {
  id: 'insight-001',
  workspaceId: WORKSPACE_ID,
  title: 'No automated tests detected',
  description: 'The repository has no test configuration.',
  confidence: 1,
  severity: 'high',
  source: 'github',
  evidence: ['testing:hasTests'],
  tags: ['rule-based', 'no-tests'],
  createdAt: new Date(),
}

describe('ExplanationBuilder', () => {
  const builder = new ExplanationBuilder()

  it('creates an explanation with the correct insightId', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.insightId).toBe('insight-001')
  })

  it('includes the applied rule id', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.appliedRules).toContain('no-tests')
  })

  it('includes evidence description', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.evidence.some((e) => e.includes('hasTests'))).toBe(true)
  })

  it('sets workspaceId correctly', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.workspaceId).toBe(WORKSPACE_ID)
  })

  it('generates a non-empty summary', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.summary.length).toBeGreaterThan(0)
  })

  it('generates a non-empty confidence reason', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.confidenceReason.length).toBeGreaterThan(0)
  })

  it('handles missing evidence gracefully', () => {
    const result: RuleResult = { ...mockRuleResult, evidenceIds: [] }
    expect(() => builder.build(mockInsight, result, [], WORKSPACE_ID)).not.toThrow()
  })

  it('assigns unique id', () => {
    const e1 = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    const e2 = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(e1.id).not.toBe(e2.id)
  })
})
