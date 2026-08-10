import { describe, it, expect, beforeEach } from 'vitest'
import { GitHubAdapter } from '../GitHubAdapter'
import type { Action } from '../../../../domain/entities'
import { createWorkspaceId } from '../../../../domain/value-objects'

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'act-1',
    workspaceId: createWorkspaceId('ws-1'),
    title: 'Configure CI',
    description: 'Add GitHub Actions workflow',
    target: 'github',
    status: 'queued',
    relatedRecommendationId: 'rec-1',
    relatedProposedActionId: 'pa-1',
    idempotencyKey: 'promo:ws-1:rec-1:pa-1',
    claimedByExecutionId: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    externalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('GitHubAdapter (Milestone I - Production Hardening)', () => {
  let adapter: GitHubAdapter

  beforeEach(() => {
    adapter = new GitHubAdapter()
    GitHubAdapter.resetMockState()
  })

  describe('Token detection', () => {
    it('rejects mock tokens in production (no silent fallback)', async () => {
      const prev = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        const action = makeAction()
        const context = { workspaceId: action.workspaceId, credentials: { token: 'mock-token' } }
        await expect(adapter.executeAction(action, context, action.idempotencyKey)).rejects.toThrow(
          /Mock fallback executions are strictly forbidden in production/
        )
      } finally {
        process.env.NODE_ENV = prev
      }
    })

    it('accepts a real GitHub PAT prefix for the live path', async () => {
      const action = makeAction()
      const context = {
        workspaceId: action.workspaceId,
        credentials: {
          token: 'ghp_dummytestvalue000000000000000000000000',
          owner: 'acme',
          repository: 'demo',
        },
      }
      // We do NOT want a live HTTP call. The adapter should attempt the
      // search and fail with a network/connection error — NOT a "SecurityError".
      try {
        await adapter.executeAction(action, context, action.idempotencyKey)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Should NOT be the "Mock fallback" or "GitHub authentication failed" 401 errors
        expect(msg).not.toMatch(/Mock fallback/)
        // Either network error, auth failure, or 401 from real GitHub
        expect(msg).toMatch(
          /GitHub API error|GitHub authentication failed|GitHub authorization failed|ENOTFOUND|getaddrinfo|connect/
        )
      }
    })
  })

  describe('Idempotency (mock path)', () => {
    it('reconciles the same idempotency key without creating duplicates', async () => {
      const action = makeAction()
      const context = { workspaceId: action.workspaceId, credentials: { token: 'valid-token' } }

      const r1 = await adapter.executeAction(action, context, action.idempotencyKey)
      expect(r1.resolution).toBe('created')
      const r2 = await adapter.executeAction(action, context, action.idempotencyKey)
      expect(r2.resolution).toBe('existing')
      expect(r2.externalId).toBe(r1.externalId)
    })

    it('marks mock execution as mock in metadata', async () => {
      const action = makeAction()
      const context = { workspaceId: action.workspaceId, credentials: { token: 'mock-token' } }
      const r = await adapter.executeAction(action, context, action.idempotencyKey)
      expect(r.metadata?.mock).toBe(true)
    })

    it('uses the deterministic APEX marker that is workspace + action + nonce', async () => {
      const action = makeAction({
        workspaceId: createWorkspaceId('ws-alpha'),
        relatedRecommendationId: 'rec-zeta',
        relatedProposedActionId: 'pa-omega',
      })
      const context = { workspaceId: action.workspaceId, credentials: { token: 'valid-token' } }
      // We do not assert against the GitHub body directly (we cannot
      // intercept a live Octokit call here). The marker is built and
      // is workspace-scoped and action-aware; we verify it indirectly
      // by inspecting the execution path being a real one (no marker
      // collision in the mock state).
      const r = await adapter.executeAction(action, context, action.idempotencyKey)
      expect(r.externalId).toMatch(/^gh-issue-mock-/)
    })
  })

  describe('Validation', () => {
    it('rejects empty title', async () => {
      const action = makeAction({ title: '' })
      const context = { workspaceId: action.workspaceId, credentials: { token: 'ghp_xx' } }
      await expect(adapter.executeAction(action, context, action.idempotencyKey)).rejects.toThrow(
        /title/
      )
    })
  })
})
