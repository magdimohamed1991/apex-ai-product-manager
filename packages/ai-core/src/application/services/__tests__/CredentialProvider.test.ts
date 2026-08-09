import { describe, it, expect, afterEach } from 'vitest'
import { EnvCredentialProvider } from '../CredentialProvider'
import { createWorkspaceId } from '../../../domain/value-objects'
import { SecurityError } from '../../../errors/AppError'

const WS = createWorkspaceId('ws-test')

/**
 * Rule 4 regression tests — production must NEVER silently downgrade to a
 * mock credential. The legacy provider returned `mock-*` tokens whenever the
 * environment variable was missing, regardless of NODE_ENV; production
 * safety relied solely on downstream adapters.
 */
describe('EnvCredentialProvider — production mock-downgrade prevention', () => {
  const provider = new EnvCredentialProvider()
  const prevNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv
    delete process.env.GITHUB_TOKEN
    delete process.env.JIRA_TOKEN
    delete process.env.LINEAR_TOKEN
    delete process.env.SLACK_TOKEN
  })

  it('returns a clearly-labeled mock token in development when GITHUB_TOKEN is missing', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.GITHUB_TOKEN
    const creds = await provider.getCredentials(WS, 'github')
    expect(creds.token).toBe('mock-github-token')
  })

  it('throws SecurityError in production when GITHUB_TOKEN is missing', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.GITHUB_TOKEN
    await expect(provider.getCredentials(WS, 'github')).rejects.toThrow(SecurityError)
  })

  it('throws SecurityError in production for every test-only adapter when its token is missing', async () => {
    process.env.NODE_ENV = 'production'
    for (const name of ['jira', 'linear', 'slack']) {
      await expect(provider.getCredentials(WS, name)).rejects.toThrow(SecurityError)
    }
  })

  it('returns the real token when configured, even in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.GITHUB_TOKEN = 'ghp_real_token_123'
    const creds = await provider.getCredentials(WS, 'github')
    expect(creds.token).toBe('ghp_real_token_123')
  })

  it('throws SecurityError for unknown providers in any environment (never fabricates credentials)', async () => {
    process.env.NODE_ENV = 'development'
    await expect(provider.getCredentials(WS, 'amplitude')).rejects.toThrow(SecurityError)
  })
})
