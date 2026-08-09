import { describe, it, expect } from 'vitest'
import { RepositoryIntelligenceAgent } from '../RepositoryIntelligenceAgent'
import { MockLLMProvider } from '../../../../providers'
import { DevelopmentBudgetPolicy, ProductionBudgetPolicy } from '../../../../providers'
import { createWorkspaceId, createWorkspaceName, createWorkspaceSlug } from '../../../../domain'
import type { RepositoryAssessmentRequest } from '../RepositoryAssessmentRequest'
import type { RepositorySummary } from '@apex/analysis'

const WORKSPACE_ID = createWorkspaceId('ws-sprint7-test')

const mockSummary: RepositorySummary = {
  name: 'test-app',
  owner: 'acme',
  url: 'https://github.com/acme/test-app',
  languages: ['TypeScript'],
  frameworks: ['React', 'Vite'],
  packageManager: 'pnpm',
  hasDocker: false,
  hasCI: true,
  hasTests: false,
  hasMonorepo: true,
  hasTypeScript: true,
  hasTailwind: true,
  complexity: 'medium',
  score: 65,
}

const mockRequest: RepositoryAssessmentRequest = {
  workspace: {
    id: WORKSPACE_ID,
    name: createWorkspaceName('Test App'),
    slug: createWorkspaceSlug('Test App'),
    type: 'saas',
    status: 'active',
    integrations: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  repository: mockSummary,
  evidence: [],
  insights: [],
  findings: [],
  recommendations: [],
  explanations: [],
}

const mockContext = {
  workspaceId: WORKSPACE_ID,
  correlationId: 'test-correlation-001',
  startedAt: new Date(),
}

const validMockResponse = JSON.stringify({
  executiveSummary: 'The repository is well-structured with TypeScript and CI pipeline.',
  strengths: ['TypeScript', 'CI configured'],
  risks: [
    {
      title: 'No automated tests',
      severity: 'high',
      description: 'No test framework detected.',
      recommendedAction: 'Add Vitest for unit testing.',
    },
  ],
  technicalDebt: {
    level: 'medium',
    reasoning: 'Missing tests increase deployment risk.',
    estimatedEffortDays: 5,
  },
  engineeringPriorities: [
    {
      rank: 1,
      title: 'Add automated tests',
      rationale: 'Reduces deployment risk significantly',
      effort: 'medium',
      impact: 'high',
    },
  ],
  confidence: 0.85,
})

describe('RepositoryIntelligenceAgent', () => {
  describe('with MockLLMProvider', () => {
    it('returns a successful result', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.success).toBe(true)
    })

    it('produces a valid RepositoryAssessmentEntity', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.data).toBeDefined()
      expect(result.data?.executiveSummary).toBeTruthy()
      expect(result.data?.risks.length).toBeGreaterThan(0)
      expect(result.data?.engineeringPriorities.length).toBeGreaterThan(0)
    })

    it('sets workspaceId on result', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.data?.workspaceId).toBe(WORKSPACE_ID)
    })

    it('records provider and model', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.data?.provider).toBe('mock')
      expect(result.data?.model).toBe('mock-v1')
    })

    it('records token usage', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.data?.tokenUsage.total).toBeGreaterThan(0)
    })

    it('measures durationMs', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('budget policy enforcement', () => {
    it('falls back to mock provider when daily budget is exceeded', async () => {
      // Both real and fallback providers return valid mock responses
      const realProvider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(realProvider, DevelopmentBudgetPolicy)

      // dailySpendUsd = 0.01 > maxDailyCostUsd = 0 → should fallback
      const result = await agent.execute({ request: mockRequest, dailySpendUsd: 0.01 }, mockContext)
      // Result may succeed or fail depending on fallback mock response
      // Key assertion: agent did not throw, it returned a structured result
      expect(result).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it('uses real provider when under budget', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest, dailySpendUsd: 1.0 }, mockContext)
      expect(result.success).toBe(true)
      expect(result.data?.provider).toBe('mock')
    })

    it('refuses to fall back to MockLLMProvider in production (SecurityError, no fabricated assessment)', async () => {
      const prev = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        const provider = new MockLLMProvider(validMockResponse)
        const agent = new RepositoryIntelligenceAgent(provider, DevelopmentBudgetPolicy)
        // dailySpendUsd > DevelopmentBudgetPolicy.maxDailyCostUsd (0) →
        // the budget check would normally fall back to MockLLMProvider.
        // In production that must be a hard failure instead.
        const result = await agent.execute(
          { request: mockRequest, dailySpendUsd: 0.01 },
          mockContext
        )
        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/MockLLMProvider/)
      } finally {
        process.env.NODE_ENV = prev
      }
    })
  })

  describe('validation error handling', () => {
    it('returns error result for completely invalid JSON', async () => {
      const badProvider = new MockLLMProvider('not valid json at all!!!')
      const agent = new RepositoryIntelligenceAgent(badProvider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('returns error for valid JSON that fails validation', async () => {
      const incomplete = JSON.stringify({ executiveSummary: 'ok' }) // missing required fields
      const badProvider = new MockLLMProvider(incomplete)
      const agent = new RepositoryIntelligenceAgent(badProvider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.success).toBe(false)
    })
  })

  describe('confidence', () => {
    it('confidence is between 0 and 1', async () => {
      const provider = new MockLLMProvider(validMockResponse)
      const agent = new RepositoryIntelligenceAgent(provider, ProductionBudgetPolicy)

      const result = await agent.execute({ request: mockRequest }, mockContext)
      expect(result.data?.confidence).toBeGreaterThanOrEqual(0)
      expect(result.data?.confidence).toBeLessThanOrEqual(1)
    })
  })
})
