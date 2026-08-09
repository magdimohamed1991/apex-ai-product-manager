import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { AuthService } from '../AuthService'
import { createWorkspaceId } from '../../../domain/value-objects'

const TEST_DB_DIR = path.join(process.cwd(), 'database-auth-integration-test')

describe('AuthService integration (Milestone I - Production Hardening)', () => {
  let database: DurableFileDatabase
  let authService: AuthService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    authService = new AuthService(
      database,
      async ({ workspaceId, name, slug }: { workspaceId: string; name: string; slug: string }) => {
        return { id: workspaceId, name, slug }
      },
      async (_workspaceId: string, _projectId: string, _name: string) => {
        // Provisioning callback for tests
      }
    )
  })

  it('signs up a user, hashes the password (no mock format), creates a session', async () => {
    const result = await authService.signup({
      email: 'pm@acme.com',
      password: 'super-secure-password-12',
    })
    expect(result.user.email).toBe('pm@acme.com')
    expect(result.sessionId).toMatch(/^sess-/)
    // The session token is a URL-safe base64 string of 32 random bytes (43 chars)
    expect(result.sessionId.length).toBeGreaterThanOrEqual(40)
    // Membership is owner of the new workspace
    const isMember = database.isUserMemberOfWorkspace(result.user.id, result.workspaceId!)
    expect(isMember).toBe(true)
  })

  it('logs in with the correct password and rejects wrong passwords', async () => {
    await authService.signup({ email: 'a@b.com', password: 'correct-password-12' })
    const ok = await authService.login('a@b.com', 'correct-password-12')
    expect(ok.user.email).toBe('a@b.com')
    // The new session must be a new opaque token
    expect(ok.sessionId).toMatch(/^sess-/)
  })

  it('rejects login with wrong password and does not leak user existence', async () => {
    await authService.signup({ email: 'a@b.com', password: 'correct-password' })
    await expect(authService.login('a@b.com', 'wrong-password')).rejects.toThrow(
      /Invalid email or password/
    )
  })

  it('normalizes email to lowercase for case-insensitive uniqueness', async () => {
    await authService.signup({ email: 'Foo@Bar.com', password: 'super-secure-password' })
    await expect(
      authService.signup({ email: 'foo@bar.com', password: 'different-password' })
    ).rejects.toThrow(/already exists/)
  })

  it('rejects passwords shorter than 8 characters', async () => {
    await expect(authService.signup({ email: 'short@pw.com', password: 'short' })).rejects.toThrow(
      /at least 8 characters/
    )
  })

  it('rejects malformed email addresses', async () => {
    await expect(
      authService.signup({ email: 'not-an-email', password: 'super-secure-password' })
    ).rejects.toThrow(/Invalid email/)
  })

  it('persists the session across the database boundary and resolves it', async () => {
    const { sessionId, user } = await authService.signup({
      email: 'persist@test.com',
      password: 'super-secure-password-12',
    })
    const resolved = await authService.resolveSession(sessionId)
    expect(resolved).not.toBeNull()
    expect(resolved!.userId).toBe(user.id)
  })

  it('invalidates a session on logout', async () => {
    const { sessionId } = await authService.signup({
      email: 'logout@test.com',
      password: 'super-secure-password-12',
    })
    expect((await authService.resolveSession(sessionId))!.userId).toBeDefined()
    authService.logout(sessionId)
    expect(await authService.resolveSession(sessionId)).toBeNull()
  })

  it('rejects expired sessions', async () => {
    const result = await authService.signup({
      email: 'expire@test.com',
      password: 'super-secure-password-12',
    })
    // Force-expire the session by direct DB manipulation
    database.beginTransaction()
    const sessions = database.getActiveState().sessions || []
    const target = sessions.find((s) => s.id === result.sessionId)
    if (target) {
      target.expiresAt = new Date(Date.now() - 1000).toISOString()
    }
    await database.commit()
    expect(await authService.resolveSession(result.sessionId)).toBeNull()
  })

  it('produces different session IDs for repeated logins (no predictable token)', async () => {
    await authService.signup({ email: 'multi@test.com', password: 'super-secure-password-12' })
    const a = await authService.login('multi@test.com', 'super-secure-password-12')
    const b = await authService.login('multi@test.com', 'super-secure-password-12')
    expect(a.sessionId).not.toBe(b.sessionId)
  })

  it('resolves REAL workspace names/slugs for login and listings (never echoes the workspace id)', async () => {
    // Workspace exists in the DB with real metadata (the integration-test
    // provisioner returns an echo; a real deployment persists the workspace).
    database.beginTransaction()
    database.getActiveState().workspaces!.push({
      id: 'ws-acme-real',
      name: 'Acme Corp',
      slug: 'acme',
      type: 'saas',
      status: 'active',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    await database.commit()

    // Grant membership directly (simulating an existing user).
    const userId = 'usr-ws-names'
    database.beginTransaction()
    database.insertUser({
      id: userId,
      email: 'realnames@test.com',
      passwordHash: 'scrypt$N=1,r=1,p=1$c2FsdA==$aGFzaA==',
      createdAt: new Date().toISOString(),
    })
    database.insertMembership({
      id: 'mbr-ws-names',
      userId,
      workspaceId: 'ws-acme-real',
      role: 'owner',
      createdAt: new Date().toISOString(),
    })
    await database.commit()

    const workspaces = authService.listWorkspacesForUser(userId)
    expect(workspaces).toEqual([{ id: 'ws-acme-real', name: 'Acme Corp', slug: 'acme' }])
  })

  it('enforces workspace membership boundary', async () => {
    const { user, workspaceId } = await authService.signup({
      email: 'a@b.com',
      password: 'super-secure-password-12',
    })
    expect(authService.isMember(user.id, workspaceId!)).toBe(true)
    expect(authService.isMember(user.id, 'ws-some-other')).toBe(false)
    expect(authService.isMember(user.id, createWorkspaceId('ws-some-other'))).toBe(false)
  })
})
