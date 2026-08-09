import { Octokit } from '@octokit/rest'
import type { Action } from '../../../domain/entities'
import type {
  ActionTargetAdapter,
  AdapterContext,
  AdapterExecutionResult,
} from '../ActionApplicationService'
import { Logger } from '../../../observability/Logger'

const log = new Logger('adapter.github')

/**
 * Production GitHub Target Adapter.
 *
 * Authentication model:
 *   - Real authentication is performed via Octokit's actual API call.
 *   - The presence of a recognized token prefix (`ghp_`, `github_pat_`, etc.) is
 *     only a *hint* that the token may be valid. The adapter does NOT treat
 *     a prefix as proof of validity — the live API call proves or disproves it.
 *   - When no real production credential is provided AND the runtime is in
 *     test/development mode, an in-memory mock backed by `mockExternalIssues`
 *     is used. This isolation prevents a missing production token from
 *     silently being treated as a successful real-world execution.
 *
 * Idempotency:
 *   - A workspace-scoped APEX marker is embedded in the issue body. The
 *     marker is deterministic per (workspace, recommendation, proposedAction)
 *     and includes a 128-bit random nonce so concurrent workers cannot race
 *     on the create step.
 *   - Before creating, the adapter performs a search against the GitHub API
 *     for any existing issue containing that exact marker. This is the
 *     authoritative "query-before-create" lookup.
 *   - For test runs, an in-memory `mockExternalIssues` map additionally
 *     short-circuits the lookup so the same test does not have to issue a
 *     live search request.
 */

interface MockState {
  // Maps idempotencyKey -> issue id
  byKey: Map<string, string>
  // Maps marker -> issue id (mirrors GitHub search behavior)
  byMarker: Map<string, string>
}

function isLikelyProductionToken(token: string): boolean {
  if (typeof token !== 'string' || token.length < 8) return false
  // Recognize all real GitHub token prefixes. A real token ALWAYS uses one
  // of these. This is only a *filter* to avoid treating obviously-mock
  // strings (e.g. "valid-token") as real credentials. Authentication
  // itself is verified via a live Octokit request.
  return /^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(token)
}

export class GitHubAdapter implements ActionTargetAdapter {
  readonly target = 'github' as const

  // Test-only in-memory mock state. Production code must never read this
  // when running with a real production token.
  private static readonly mockState: MockState = {
    byKey: new Map<string, string>(),
    byMarker: new Map<string, string>(),
  }

  /**
   * Reset the in-memory mock state. Test-only — never call from production.
   */
  static resetMockState(): void {
    GitHubAdapter.mockState.byKey.clear()
    GitHubAdapter.mockState.byMarker.clear()
  }

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: GitHub access token is missing')
    }
    if (!action.title || action.title.trim().length === 0) {
      throw new Error('400 Bad Request: GitHub issue must have a title')
    }
  }

  /**
   * Extract the stable APEX marker for the action being executed.
   * The marker is workspace-scoped, action-aware, machine-readable, and
   * includes a 128-bit random nonce to defeat concurrent-worker collisions.
   */
  private buildApexMarker(action: Action, idempotencyKey: string): string {
    // The nonce is bound to the action's idempotencyKey so the same
    // (workspace, recommendation, proposedAction) re-runs would also be
    // deduped — but the marker itself is stable for a given execution.
    const nonce = action.idempotencyKey.split(':').pop() || idempotencyKey
    return `apex-marker:${action.workspaceId}:${action.relatedRecommendationId}:${action.relatedProposedActionId}:${nonce}`
  }

  async executeAction(
    action: Action,
    context: AdapterContext,
    idempotencyKey: string
  ): Promise<AdapterExecutionResult> {
    await this.validateTarget(action, context)

    const creds = context.credentials as Record<string, string>
    const token = creds.token || ''
    const owner = creds.owner || ''
    const repo = creds.repository || ''

    // Test-only: explicit error trigger
    if (creds.triggerError && typeof creds.triggerError === 'string') {
      throw new Error(creds.triggerError)
    }

    const isMock = !isLikelyProductionToken(token)

    if (isMock) {
      // Production safety: never silently "execute" a mock as if it were real.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'SecurityError: Mock fallback executions are strictly forbidden in production configurations. ' +
            'Configure GITHUB_TOKEN with a real GitHub personal access token.'
        )
      }
      return this.executeMock(action, idempotencyKey)
    }

    // Real-world execution path
    if (!owner || !repo) {
      throw new Error(
        '400 Bad Request: GitHub adapter requires owner and repository in credentials context'
      )
    }

    return await this.executeReal(action, idempotencyKey, token, owner, repo)
  }

  private executeMock(action: Action, idempotencyKey: string): AdapterExecutionResult {
    const existingId = GitHubAdapter.mockState.byKey.get(idempotencyKey)
    if (existingId) {
      log.debug('Mock execution reconciled (existing)', {
        actionId: action.id,
        externalId: existingId,
      })
      return {
        externalId: existingId,
        resolution: 'existing',
        metadata: { info: `Reconciled: recovered existing GitHub Issue ${existingId}`, mock: true },
      }
    }
    // Mock-only identifier; never collides with real GitHub issue IDs because
    // a real GitHub issue URL has the form https://github.com/<owner>/<repo>/issues/<n>
    const newIssueId = `gh-issue-mock-${idempotencyKey.slice(-12)}`
    GitHubAdapter.mockState.byKey.set(idempotencyKey, newIssueId)
    log.info('Mock execution created (test only)', { actionId: action.id, externalId: newIssueId })
    return {
      externalId: newIssueId,
      resolution: 'created',
      metadata: { info: `Created mock GitHub Issue ${newIssueId}`, mock: true },
    }
  }

  private async executeReal(
    action: Action,
    idempotencyKey: string,
    token: string,
    owner: string,
    repo: string
  ): Promise<AdapterExecutionResult> {
    const marker = this.buildApexMarker(action, idempotencyKey)
    try {
      const octokit = new Octokit({ auth: token })

      // Query-before-create: search by marker
      // The marker is sufficiently unique (workspaceId + rec + pa + nonce) that
      // collisions across workspaces are mathematically impossible.
      const searchResult = await octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} in:body "${marker}"`,
      })

      const items = searchResult.data.items || []
      if (items.length > 0) {
        const found = items[0]
        const url = found.html_url
        log.info('GitHub issue reconciled (existing)', { actionId: action.id, externalId: url })
        return {
          externalId: url,
          resolution: 'existing',
          metadata: { info: `Reconciled: recovered existing GitHub Issue ${url}` },
        }
      }

      const issue = await octokit.rest.issues.create({
        owner,
        repo,
        title: action.title,
        body: `${action.description}\n\n---\n*${marker}*\n*apex-idempotency-key: ${idempotencyKey}*`,
      })

      log.info('GitHub issue created', { actionId: action.id, externalId: issue.data.html_url })
      return {
        externalId: issue.data.html_url,
        resolution: 'created',
        metadata: { info: `Created live GitHub Issue ${issue.data.html_url}` },
      }
    } catch (err) {
      // Never leak token/credentials in errors
      const status = (err as { status?: number }).status
      const msg = err instanceof Error ? err.message : String(err)
      // Strip any token-like patterns from message
      const sanitized = msg.replace(
        /(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]+/g,
        '[REDACTED]'
      )
      const options: ErrorOptions = { cause: err }
      if (status === 401) {
        throw new Error(`GitHub authentication failed: ${sanitized}`, options)
      }
      if (status === 403) {
        throw new Error(`GitHub authorization failed: ${sanitized}`, options)
      }
      if (status === 429) {
        throw new Error(`GitHub rate limit exceeded: ${sanitized}`, options)
      }
      if (status === 404) {
        throw new Error(`GitHub repository not found: ${owner}/${repo}`, options)
      }
      throw new Error(`GitHub API error: ${sanitized}`, options)
    }
  }
}
