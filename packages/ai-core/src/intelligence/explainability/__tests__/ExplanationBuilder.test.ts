import { describe, it, expect } from 'vitest'
import { ExplanationBuilder } from '../ExplanationBuilder'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { Insight } from '../../../domain'
import type { Evidence, RuleResult } from '@apex/analysis'

const WORKSPACE_ID = createWorkspaceId('ws-test')

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
  evidenceIds: ['testing:hasTests'],
  tags: ['rule-based', 'no-tests'],
  createdAt: new Date(),
}

describe('ExplanationBuilder', () => {
  const builder = new ExplanationBuilder()

  it('creates an explanation with the correct insightIds', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.insightIds).toEqual(['insight-001'])
    expect(explanation.findingIds).toEqual([])
  })

  it('includes the applied rule id', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.appliedRules).toContain('no-tests')
  })

  it('includes evidence id in evidenceIds', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.evidenceIds).toContain('testing:hasTests')
  })

  it('sets workspaceId correctly', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.workspaceId).toBe(WORKSPACE_ID)
  })

  it('generates a non-empty summary', () => {
    const explanation = builder.build(mockInsight, mockRuleResult, [mockEvidence], WORKSPACE_ID)
    expect(explanation.summary.length).toBeGreaterThan(0)
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
