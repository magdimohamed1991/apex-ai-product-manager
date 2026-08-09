import { Logger } from '../../observability/Logger'
import { AuthenticationError, ConflictError, ValidationError } from '../../errors/AppError'
import { SecureIdGenerator } from '../../security/IdGenerator'
import { ScryptPasswordHasher } from '../../security/PasswordHasher'
import type {
  DurableFileDatabase,
  UserRecord,
  SessionRecord,
  WorkspaceMembership,
} from '../../infrastructure/database/DurableFileDatabase'
import type { WorkspaceId } from '../../domain/value-objects'

const log = new Logger('auth.service')

/**
 * AuthService (Milestone I - Production Hardening)
 *
 * Handles signup, login, session lookup, and logout.
 *
 * Guarantees:
 *   - Passwords are stored using a memory-hard KDF (scrypt by default).
 *   - Session identifiers are 256-bit cryptographically random tokens
 *     generated via Node's `crypto.randomBytes`.
 *   - Sessions expire after a fixed TTL; logout invalidates the session
 *     server-side.
 *   - No password hashes are ever returned through the API.
 *   - Email addresses are normalized to lowercase for case-insensitive
 *     uniqueness.
 */
export interface AuthenticatedSession {
  user: { id: string; email: string }
  sessionId: string
  expiresAt: string
  workspaceId: string | null
  workspaces: { id: string; name: string; slug: string }[]
}

export interface SignupInput {
  email: string
  password: string
  workspaceName?: string
  workspaceSlug?: string
  workspaceId?: string
}

export class AuthService {
  private readonly hasher = new ScryptPasswordHasher()
  private readonly SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

  constructor(
    private readonly database: DurableFileDatabase,
    private readonly workspaceProvisioner: (input: {
      workspaceId: string
      name: string
      slug: string
    }) => Promise<{ id: string; name: string; slug: string } | null>,
    private readonly projectProvisioner: (
      workspaceId: string,
      projectId: string,
      name: string
    ) => Promise<void>
  ) {}

  /**
   * Normalize and validate an email address.
   */
  private normalizeEmail(raw: string): string {
    const email = String(raw ?? '')
      .trim()
      .toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      throw new ValidationError('Invalid email address')
    }
    return email
  }

  /**
   * Validate a password against minimum security requirements.
   */
  private validatePassword(pw: string): void {
    if (typeof pw !== 'string' || pw.length < 8) {
      throw new ValidationError('Password must be at least 8 characters')
    }
    if (pw.length > 1024) {
      throw new ValidationError('Password exceeds maximum supported length')
    }
  }

  async signup(input: SignupInput): Promise<AuthenticatedSession> {
    const email = this.normalizeEmail(input.email)
    this.validatePassword(input.password)

    if (this.database.getUserByEmail(email)) {
      throw new ConflictError('A user with this email already exists')
    }

    const passwordHash = await this.hasher.hash(input.password)
    const userId = `usr-${SecureIdGenerator.token(16)}`
    const now = new Date()
    const user: UserRecord = {
      id: userId,
      email,
      passwordHash,
      createdAt: now.toISOString(),
    }

    const userSlug =
      email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'user'
    const workspaceId = input.workspaceId || `ws-${userSlug}-${SecureIdGenerator.token(6)}`
    const workspaceName = input.workspaceName || `${email.split('@')[0]}'s Workspace`
    const workspaceSlug =
      (input.workspaceSlug || userSlug)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || userSlug

    // Provision workspace + default project first; the user is added to
    // the membership only after the workspace exists, so the foreign key
    // contract is upheld.
    const ws = await this.workspaceProvisioner({
      workspaceId,
      name: workspaceName,
      slug: workspaceSlug,
    })
    if (!ws) {
      throw new Error('Workspace provisioning failed')
    }
    await this.projectProvisioner(workspaceId, 'proj-core', 'APEX System Core')

    // All inserts in one transaction.
    this.database.beginTransaction()
    try {
      this.database.insertUser(user)
      const membership: WorkspaceMembership = {
        id: `mbr-${SecureIdGenerator.token(12)}`,
        userId,
        workspaceId,
        role: 'owner',
        createdAt: now.toISOString(),
      }
      this.database.insertMembership(membership)
      const session = this.createSession(userId, workspaceId)
      await this.database.commit()
      log.info('User signed up', { userId, workspaceId })
      return {
        user: { id: user.id, email: user.email },
        sessionId: session.id,
        expiresAt: session.expiresAt,
        workspaceId,
        workspaces: [ws],
      }
    } catch (err) {
      this.database.rollback()
      throw err
    }
  }

  async login(email: string, password: string): Promise<AuthenticatedSession> {
    const normalized = this.normalizeEmail(email)
    const user = this.database.getUserByEmail(normalized)
    if (!user) {
      // Always perform a hash comparison even when the user is missing to
      // mitigate timing oracles that distinguish "user not found" vs
      // "wrong password" responses.
      await this.hasher.hash('decoy-padding-string-to-defeat-timing-oracle')
      throw new AuthenticationError('Invalid email or password')
    }
    const ok = await this.hasher.verify(password, user.passwordHash)
    if (!ok) {
      throw new AuthenticationError('Invalid email or password')
    }
    const memberships = this.database.getMembershipsForUser(user.id)
    const workspaceId = memberships[0]?.workspaceId || null

    this.database.beginTransaction()
    try {
      const session = this.createSession(user.id, workspaceId || undefined)
      await this.database.commit()
      const workspaces: { id: string; name: string; slug: string }[] = []
      for (const m of memberships) {
        const ws = await this.workspaceProvisioner({
          workspaceId: m.workspaceId,
          name: m.workspaceId,
          slug: m.workspaceId,
        })
        if (ws) workspaces.push(ws)
      }
      log.info('User logged in', { userId: user.id, workspaceCount: workspaces.length })
      return {
        user: { id: user.id, email: user.email },
        sessionId: session.id,
        expiresAt: session.expiresAt,
        workspaceId,
        workspaces,
      }
    } catch (err) {
      this.database.rollback()
      throw err
    }
  }

  /**
   * Look up a session by token, returning the user, workspace, and expiry.
   * Returns null when the session is missing or expired.
   */
  async resolveSession(token: string): Promise<{
    userId: string
    workspaceId: string | null
    sessionId: string
    expiresAt: string
  } | null> {
    if (typeof token !== 'string' || token.length < 16) return null
    const session = this.database.getSession(token)
    if (!session) return null
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.database.deleteSession(token)
      return null
    }
    return {
      userId: session.userId,
      workspaceId: session.workspaceId || null,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    }
  }

  logout(token: string): void {
    if (typeof token !== 'string' || token.length < 16) return
    this.database.beginTransaction()
    try {
      this.database.deleteSession(token)
      this.database.commit()
    } catch (err) {
      this.database.rollback()
      throw err
    }
  }

  listWorkspacesForUser(userId: string): { id: string; name: string; slug: string }[] {
    const memberships = this.database.getMembershipsForUser(userId)
    return memberships.map((m) => ({ id: m.workspaceId, name: m.workspaceId, slug: m.workspaceId }))
  }

  isMember(userId: string, workspaceId: WorkspaceId | string): boolean {
    return this.database.isUserMemberOfWorkspace(userId, String(workspaceId))
  }

  private createSession(userId: string, workspaceId?: string): SessionRecord {
    const id = `sess-${SecureIdGenerator.token(32)}`
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.SESSION_TTL_MS)
    const session: SessionRecord = {
      id,
      userId,
      workspaceId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    }
    this.database.insertSession(session)
    return session
  }
}
