/// <reference types="node" />

import type { WorkspaceId } from '../../domain/value-objects'
import { SecurityError } from '../../errors/AppError'

export interface ProviderCredentials {
  token: string
  username?: string
}

export interface CredentialProvider {
  getCredentials(workspaceId: WorkspaceId, provider: string): Promise<ProviderCredentials>
}

/**
 * Secure Environment-Backed Runtime Credential Provider
 *
 * Implements the injectable credential provider boundary, centralizing credential management
 * and preventing any propagation of process.env or sensitive variables within domain/database layers.
 *
 * Production safety (Milestone I - Production Hardening):
 *   - In `NODE_ENV=production`, a missing provider token is a HARD ERROR
 *     (`SecurityError`). The provider MUST NOT return a placeholder mock
 *     token that downstream code could mistake for a real credential.
 *   - In development/test environments only, a clearly-labeled `mock-*`
 *     token is returned so local flows can run without real credentials.
 *     Downstream adapters additionally refuse mock execution in production.
 */
export class EnvCredentialProvider implements CredentialProvider {
  async getCredentials(_workspaceId: WorkspaceId, provider: string): Promise<ProviderCredentials> {
    const envName = provider.toUpperCase()

    if (provider.toLowerCase() === 'github') {
      const token = process.env.GITHUB_TOKEN
      if (!token) {
        if (process.env.NODE_ENV === 'production') {
          throw new SecurityError(
            'GITHUB_TOKEN is not configured. Production execution requires a real GitHub personal access token; refusing to fall back to a mock.'
          )
        }
        return { token: 'mock-github-token' }
      }
      return { token }
    }
    if (provider.toLowerCase() === 'jira') {
      const token = process.env.JIRA_TOKEN
      if (!token) {
        if (process.env.NODE_ENV === 'production') {
          throw new SecurityError(
            'JIRA_TOKEN is not configured. The Jira adapter is test-only and must not run in production.'
          )
        }
        return { token: 'mock-jira-token' }
      }
      return { token }
    }
    if (provider.toLowerCase() === 'linear') {
      const token = process.env.LINEAR_TOKEN
      if (!token) {
        if (process.env.NODE_ENV === 'production') {
          throw new SecurityError(
            'LINEAR_TOKEN is not configured. The Linear adapter is test-only and must not run in production.'
          )
        }
        return { token: 'mock-linear-token' }
      }
      return { token }
    }
    if (provider.toLowerCase() === 'slack') {
      const token = process.env.SLACK_TOKEN
      if (!token) {
        if (process.env.NODE_ENV === 'production') {
          throw new SecurityError(
            'SLACK_TOKEN is not configured. The Slack adapter is test-only and must not run in production.'
          )
        }
        return { token: 'mock-slack-token' }
      }
      return { token }
    }

    // Unknown provider: never fabricate credentials, regardless of environment.
    throw new SecurityError(`Unsupported credential provider: "${provider}" (${envName})`)
  }
}
