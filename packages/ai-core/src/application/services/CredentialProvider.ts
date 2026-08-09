/// <reference types="node" />

import type { WorkspaceId } from '../../domain/value-objects'

export interface ProviderCredentials {
  token: string
  username?: string
}

export interface CredentialProvider {
  getCredentials(
    workspaceId: WorkspaceId,
    provider: string
  ): Promise<ProviderCredentials>
}

/**
 * Secure Environment-Backed Runtime Credential Provider
 *
 * Implements the injectable credential provider boundary, centralizing credential management
 * and preventing any propagation of process.env or sensitive variables within domain/database layers.
 */
export class EnvCredentialProvider implements CredentialProvider {
  async getCredentials(
    _workspaceId: WorkspaceId,
    provider: string
  ): Promise<ProviderCredentials> {
    if (provider.toLowerCase() === 'github') {
      const token = process.env.GITHUB_TOKEN || 'mock-github-token'
      return { token }
    }
    if (provider.toLowerCase() === 'jira') {
      const token = process.env.JIRA_TOKEN || 'mock-jira-token'
      return { token }
    }
    return { token: 'mock-token' }
  }
}
