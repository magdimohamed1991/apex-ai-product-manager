import { Octokit } from '@octokit/rest'
import type { Action } from '../../../domain/entities'
import type { ActionTargetAdapter, AdapterContext, AdapterExecutionResult } from '../ActionApplicationService'

/**
 * Production GitHub Target Adapter (Milestone H1)
 *
 * Implements real-world GitHub API interactions via @octokit/rest.
 * Supports Query-before-Create lookups, external idempotency, rate-limit error triggering,
 * and falls back gracefully to a high-fidelity mock client for testing environments.
 */
export class GitHubAdapter implements ActionTargetAdapter {
  readonly target = 'github' as const

  // Shared mock external server state to preserve high-fidelity testing capability
  static readonly mockExternalIssues = new Map<string, string>()

  async validateTarget(action: Action, context: AdapterContext): Promise<void> {
    if (!context.credentials || Object.keys(context.credentials).length === 0) {
      throw new Error('401 Unauthorized: GitHub access token is missing or invalid')
    }
    if (!action.title || action.title.trim().length === 0) {
      throw new Error('400 Bad Request: GitHub issue must have a title')
    }
  }

  async executeAction(
    action: Action,
    context: AdapterContext,
    idempotencyKey: string
  ): Promise<AdapterExecutionResult> {
    console.log('GitHubAdapter executeAction - Key passed:', idempotencyKey)
    
    // 1. Validate Target and Auth Context
    await this.validateTarget(action, context)

    const creds = context.credentials as Record<string, string>
    const token = creds.token || ''
    const owner = creds.owner || 'mock-owner'
    const repo = creds.repository || 'mock-repo'

    // 2. Trigger mock API error triggers based on credential instructions to test error normalization
    if (creds.triggerError) {
      throw new Error(creds.triggerError)
    }

    // 3. Graceful fallback for mock testing environments
    const isRealToken = token.startsWith('ghp_') || token.startsWith('github_pat_') || token.startsWith('ghu_') || token.startsWith('ghs_')
    const isMockToken = !isRealToken

    if (isMockToken && process.env.NODE_ENV === 'production') {
      throw new Error('SecurityError: Mock fallback executions are strictly forbidden in production configurations.')
    }

    if (isMockToken) {
      const existingId = GitHubAdapter.mockExternalIssues.get(idempotencyKey)
      if (existingId) {
        return {
          externalId: existingId,
          resolution: 'existing',
          metadata: { info: `Reconciled: recovered existing GitHub Issue ${existingId}` },
        }
      }

      const newIssueId = `gh-issue-${Math.floor(Math.random() * 100000)}`
      GitHubAdapter.mockExternalIssues.set(idempotencyKey, newIssueId)

      return {
        externalId: newIssueId,
        resolution: 'created',
        metadata: { info: `Created GitHub Issue ${newIssueId}` },
      }
    }

    // 4. Real-world Octokit integration (Item 5)
    try {
      const octokit = new Octokit({ auth: token })

      // Query before Create (Query-before-Create lookup for stable external idempotency) (Item 6)
      // Search for issues with our stable idempotency key in their body
      const searchResult = await octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} in:body "${idempotencyKey}"`,
      })

      if (searchResult.data.items && searchResult.data.items.length > 0) {
        const found = searchResult.data.items[0]
        const issueUrl = found.html_url
        return {
          externalId: issueUrl,
          resolution: 'existing',
          metadata: { info: `Reconciled: recovered existing GitHub Issue ${issueUrl}` },
        }
      }

      // Create live GitHub issue representing the APEX recommendation
      const issue = await octokit.rest.issues.create({
        owner,
        repo,
        title: action.title,
        body: `${action.description}\n\n---\n*apex-action-id: ${action.id}*\n*apex-idempotency-key: ${idempotencyKey}*`,
      })

      return {
        externalId: issue.data.html_url,
        resolution: 'created',
        metadata: { info: `Created live GitHub Issue ${issue.data.html_url}` },
      }
    } catch (err) {
      // Normalize and bubbles up HTTP errors
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`GitHub API Error: ${msg}`, { cause: err })
    }
  }
}
