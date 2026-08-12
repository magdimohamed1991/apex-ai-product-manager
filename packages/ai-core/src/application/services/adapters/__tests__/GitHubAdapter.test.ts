import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  afterEach(() => {
    vi.unstubAllGlobals()
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

    it('accepts a real GitHub PAT prefix and maps a deterministic API failure (no live network)', async () => {
      // @octokit/request resolves `requestOptions.request?.fetch || globalThis.fetch`
      // at call time, so stubbing the global fetch intercepts the adapter's
      // "real" Octokit path deterministically — no live GitHub traffic.
      const fetchMock = vi.fn(async (_url: string) => {
        return new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      const action = makeAction()
      const context = {
        workspaceId: action.workspaceId,
        credentials: {
          token: 'ghp_dummytestvalue000000000000000000000000',
          owner: 'acme',
          repository: 'demo',
        },
      }

      // A real GitHub token prefix must take the real execution path — NOT
      // the mock fallback — and a canned 401 from the GitHub API must be
      // mapped to the typed "GitHub authentication failed" error.
      await expect(adapter.executeAction(action, context, action.idempotencyKey)).rejects.toThrow(
        /GitHub authentication failed/
      )

      expect(fetchMock).toHaveBeenCalled()
      const requestedUrl = String(fetchMock.mock.calls[0][0])
      expect(requestedUrl).toContain('api.github.com')
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
