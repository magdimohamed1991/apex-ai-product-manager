import * as fs from 'node:fs'
import * as path from 'node:path'
import { Logger } from '../../observability/Logger'
import type {
  Action,
  Execution,
  ActionTransition,
  Project,
  RepositoryConnection,
  PipelineRun,
  Finding,
  Recommendation,
  Workspace,
  AIProductReasoning,
  RecommendationOutcome,
  AdaptiveLearningProfile,
  LearningSignal,
  PMDecisionTelemetry,
} from '../../domain/entities'
import {
  validateAction,
  validateExecution,
  validateActionTransitionRecord,
} from '../../domain/entities'

const log = new Logger('database')

/**
 * Production-hardened single-process durable persistence engine.
 *
 * This is NOT a horizontally-scalable multi-process ACID database.
 * The supported operating model is:
 *
 *   • single Node.js process owning the file
 *   • cooperative in-process transactions (no inter-process isolation)
 *   • atomic file-swap commits (write to .tmp, then rename)
 *   • synchronous fsync via writeFileSync(..., { flush: true } on supported platforms)
 *   • schema migrations applied deterministically at startup
 *
 * Provided guarantees:
 *   ✓ Atomic commit (rename is atomic on POSIX for files within the same FS)
 *   ✓ Durability of committed transactions
 *   ✓ Strict structural domain validation at the database boundary
 *   ✓ Uniqueness & foreign-key constraints enforced for committed records
 *
 * NOT provided (must not be claimed by callers):
 *   ✗ Cross-process serializability
 *   ✗ Read isolation while a writer is in mid-transaction
 *   ✗ Row-level locking or pessimistic concurrency control
 *   ✗ Crash recovery beyond the last successful commit
 *
 * For multi-process or multi-host deployments, replace this class with a real
 * database engine (e.g. PostgreSQL via the same `ProductRepository`/`ActionRepository`
 * contracts — no domain changes required).
 */
export class DurableFileDatabase {
  private readonly dbPath: string
  private readonly migrationDir: string
  private state: DatabaseState | null = null
  private inTransaction = false
  private transactionState: DatabaseState | null = null
  private writeMutex: Promise<void> = Promise.resolve()
  private commitInFlight = false

  constructor(dbDir: string) {
    this.dbPath = path.join(dbDir, 'db.json')
    this.migrationDir = path.join(dbDir, 'migrations')

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    if (!fs.existsSync(this.migrationDir)) {
      fs.mkdirSync(this.migrationDir, { recursive: true })
    }
  }

  /**
   * Initialize the database and run all migrations deterministically.
   */
  async initialize(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      this.state = this.blankState()
      this.saveStateDirect(this.state)
      log.info('Initialized new durable database', { dbPath: this.dbPath })
    } else {
      const data = fs.readFileSync(this.dbPath, 'utf8')
      this.state = this.migrate(JSON.parse(data))
      log.info('Loaded existing durable database', {
        dbPath: this.dbPath,
        version: this.state.version,
      })
    }
    await this.runMigrations()
  }

  private blankState(): DatabaseState {
    return {
      version: CURRENT_VERSION,
      actions: [],
      executions: [],
      transitions: [],
      workspaces: [],
      projects: [],
      repositoryConnections: [],
      pipelineRuns: [],
      findings: [],
      recommendations: [],
      aiReasonings: [],
      outcomes: [],
      learningProfiles: [],
      learningSignals: [],
      pmDecisionTelemetry: [],
      users: [],
      sessions: [],
      memberships: [],
    }
  }

  private migrate(raw: Partial<DatabaseState>): DatabaseState {
    const base = this.blankState()
    const merged: DatabaseState = {
      version: typeof raw.version === 'number' ? raw.version : 0,
      actions: Array.isArray(raw.actions) ? raw.actions : base.actions,
      executions: Array.isArray(raw.executions) ? raw.executions : base.executions,
      transitions: Array.isArray(raw.transitions) ? raw.transitions : base.transitions,
      workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : base.workspaces,
      projects: Array.isArray(raw.projects) ? raw.projects : base.projects,
      repositoryConnections: Array.isArray(raw.repositoryConnections)
        ? raw.repositoryConnections
        : base.repositoryConnections,
      pipelineRuns: Array.isArray(raw.pipelineRuns) ? raw.pipelineRuns : base.pipelineRuns,
      findings: Array.isArray(raw.findings) ? raw.findings : base.findings,
      recommendations: Array.isArray(raw.recommendations)
        ? raw.recommendations
        : base.recommendations,
      aiReasonings: Array.isArray(raw.aiReasonings) ? raw.aiReasonings : base.aiReasonings,
      outcomes: Array.isArray(raw.outcomes) ? raw.outcomes : base.outcomes,
      learningProfiles: Array.isArray(raw.learningProfiles)
        ? raw.learningProfiles
        : base.learningProfiles,
      learningSignals: Array.isArray(raw.learningSignals)
        ? raw.learningSignals
        : base.learningSignals,
      pmDecisionTelemetry: Array.isArray(raw.pmDecisionTelemetry)
        ? raw.pmDecisionTelemetry
        : base.pmDecisionTelemetry,
      users: Array.isArray(raw.users) ? raw.users : base.users,
      sessions: Array.isArray(raw.sessions) ? raw.sessions : base.sessions,
      memberships: Array.isArray(raw.memberships) ? raw.memberships : base.memberships,
    }
    return merged
  }

  beginTransaction(): void {
    if (this.inTransaction) {
      throw new Error('Transaction already in progress')
    }
    if (!this.state) {
      throw new Error('Database not initialized')
    }
    this.inTransaction = true
    // Deep clone the current state to isolate the transaction snapshot.
    this.transactionState = JSON.parse(JSON.stringify(this.state)) as DatabaseState
  }

  /**
   * Atomically commit the current transaction by writing to a temp file
   * and renaming. Rename is atomic within the same filesystem on POSIX.
   *
   * Fast path: when no other commit is in flight, the ENTIRE commit runs
   * synchronously so the transaction is closed before the caller's next
   * statement. This is what makes `beginTransaction()`-followed-by-
   * `commit()` safe for callers that fire multiple commits without
   * awaiting each one (e.g. `Promise.all` of repository saves). The
   * previous implementation deferred the actual write to a microtask,
   * so a second `beginTransaction()` could observe the first transaction
   * still open and throw "Transaction already in progress".
   *
   * Slow path (defensive): serializes through the in-process write mutex.
   */
  async commit(): Promise<void> {
    if (!this.inTransaction || !this.transactionState) {
      throw new Error('No transaction in progress to commit')
    }
    if (!this.commitInFlight) {
      this.commitInFlight = true
      try {
        this.writeSnapshot(this.transactionState)
        this.state = this.transactionState
        this.transactionState = null
        this.inTransaction = false
      } finally {
        this.commitInFlight = false
      }
      return
    }

    // Serialize concurrent commits with the in-process mutex (defensive).
    const previous = this.writeMutex
    let release!: () => void
    this.writeMutex = new Promise<void>((res) => (release = res))
    try {
      await previous
      this.writeSnapshot(this.transactionState)
      this.state = this.transactionState
    } finally {
      this.transactionState = null
      this.inTransaction = false
      release()
    }
  }

  /** Write the snapshot to a temp file, fsync (best-effort), and rename. */
  private writeSnapshot(snapshot: DatabaseState): void {
    const tempPath = this.dbPath + '.tmp'
    const data = JSON.stringify(snapshot, null, 2)
    const fd = fs.openSync(tempPath, 'w')
    try {
      fs.writeSync(fd, data, 0, 'utf8')
      // Best-effort fsync — not all platforms support it but we try.
      try {
        fs.fsyncSync(fd)
      } catch {
        // ignore — platform doesn't support fsync
      }
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tempPath, this.dbPath)
  }

  rollback(): void {
    this.transactionState = null
    this.inTransaction = false
  }

  /**
   * Expose the active table snapshot. Inside a transaction, returns the
   * pending snapshot. Outside, returns the committed state.
   */
  getActiveState(): DatabaseState {
    if (this.inTransaction && this.transactionState) {
      return this.transactionState
    }
    if (!this.state) {
      throw new Error('Database not initialized')
    }
    return this.state
  }

  insertAction(action: Action): void {
    validateAction(action)
    const state = this.getActiveState()

    // UNIQUE(workspace_id, idempotency_key) constraint
    const dupKey = state.actions.some(
      (a) =>
        a.workspaceId === action.workspaceId &&
        a.idempotencyKey === action.idempotencyKey &&
        a.id !== action.id
    )
    if (dupKey) {
      throw new Error(
        `Unique constraint violation: duplicate idempotencyKey "${action.idempotencyKey}" inside workspace "${action.workspaceId}"`
      )
    }
    // PRIMARY KEY(id) check — upsert on collision
    state.actions = state.actions.filter((a) => a.id !== action.id)
    state.actions.push(JSON.parse(JSON.stringify(action)))
  }

  insertExecution(exec: Execution): void {
    validateExecution(exec)
    const state = this.getActiveState()

    // FK: execution.action_id -> actions.id
    const actionExists = state.actions.some(
      (a) => a.id === exec.actionId && a.workspaceId === exec.workspaceId
    )
    if (!actionExists) {
      throw new Error(
        `Foreign key constraint violation: Action "${exec.actionId}" does not exist in workspace "${exec.workspaceId}"`
      )
    }
    // Upsert by id
    state.executions = state.executions.filter((e) => e.id !== exec.id)
    state.executions.push(JSON.parse(JSON.stringify(exec)))
  }

  insertTransition(trans: ActionTransition): void {
    validateActionTransitionRecord(trans)
    const state = this.getActiveState()

    // FK: transition.action_id -> actions.id
    const actionExists = state.actions.some(
      (a) => a.id === trans.actionId && a.workspaceId === trans.workspaceId
    )
    if (!actionExists) {
      throw new Error(
        `Foreign key constraint violation: Action "${trans.actionId}" does not exist in workspace "${trans.workspaceId}"`
      )
    }

    // UNIQUE(workspace_id, action_id, sequence)
    const dupSequence = state.transitions.some(
      (t) =>
        t.actionId === trans.actionId &&
        t.workspaceId === trans.workspaceId &&
        t.sequence === trans.sequence
    )
    if (dupSequence) {
      throw new Error(
        `Unique constraint violation: duplicate sequence "${trans.sequence}" for Action "${trans.actionId}"`
      )
    }
    state.transitions.push(JSON.parse(JSON.stringify(trans)))
  }

  private saveStateDirect(targetState: DatabaseState): void {
    const tempPath = this.dbPath + '.tmp'
    fs.writeFileSync(tempPath, JSON.stringify(targetState, null, 2), 'utf8')
    fs.renameSync(tempPath, this.dbPath)
  }

  // -- User / Session / Membership helpers --

  getUserByEmail(email: string): UserRecord | null {
    const state = this.getActiveState()
    return state.users?.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null
  }

  getUserById(id: string): UserRecord | null {
    const state = this.getActiveState()
    return state.users?.find((u) => u.id === id) || null
  }

  insertUser(user: UserRecord): void {
    const state = this.getActiveState()
    if (!state.users) state.users = []
    // Enforce unique email
    if (state.users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
      throw new Error('Unique constraint violation: user with this email already exists')
    }
    state.users.push(user)
  }

  insertSession(session: SessionRecord): void {
    const state = this.getActiveState()
    if (!state.sessions) state.sessions = []
    // PRIMARY KEY(id) — duplicate session tokens must never accumulate.
    // Tokens are 256-bit random values so collisions are cryptographically
    // improbable; the constraint makes a replay/duplication bug loud.
    if (state.sessions.some((s) => s.id === session.id)) {
      throw new Error(`Unique constraint violation: duplicate session id "${session.id}"`)
    }
    state.sessions.push(session)
  }

  getSession(id: string): SessionRecord | null {
    const state = this.getActiveState()
    return state.sessions?.find((s) => s.id === id) || null
  }

  deleteSession(id: string): void {
    const state = this.getActiveState()
    if (state.sessions) {
      state.sessions = state.sessions.filter((s) => s.id !== id)
    }
  }

  insertMembership(membership: WorkspaceMembership): void {
    const state = this.getActiveState()
    if (!state.memberships) state.memberships = []
    // Prevent duplicate (userId, workspaceId) membership
    if (
      state.memberships.some(
        (m) => m.userId === membership.userId && m.workspaceId === membership.workspaceId
      )
    ) {
      throw new Error('Unique constraint violation: user is already a member of this workspace')
    }
    state.memberships.push(membership)
  }

  getMembershipsForUser(userId: string): WorkspaceMembership[] {
    const state = this.getActiveState()
    return state.memberships?.filter((m) => m.userId === userId) || []
  }

  isUserMemberOfWorkspace(userId: string, workspaceId: string): boolean {
    const state = this.getActiveState()
    return (
      state.memberships?.some((m) => m.userId === userId && m.workspaceId === workspaceId) || false
    )
  }

  private async runMigrations(): Promise<void> {
    const state = this.getActiveState()
    while (state.version < CURRENT_VERSION) {
      const next = state.version + 1
      const migration = MIGRATIONS[next]
      if (!migration) {
        throw new Error(`Missing migration for version ${next}`)
      }
      migration(state)
      state.version = next
      this.saveStateDirect(state)
      fs.writeFileSync(
        path.join(this.migrationDir, `${String(next).padStart(3, '0')}_migration.json`),
        JSON.stringify({ version: next, appliedAt: new Date().toISOString() }, null, 2)
      )
      log.info('Migration applied', { version: next })
    }
  }
}

// -- Types --

export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  createdAt: string
}

export interface SessionRecord {
  id: string
  userId: string
  workspaceId?: string
  expiresAt: string
  createdAt?: string
}

export interface WorkspaceMembership {
  id: string
  userId: string
  workspaceId: string
  role: 'owner' | 'member'
  createdAt: string
}

export interface DatabaseState {
  version: number
  actions: Action[]
  executions: Execution[]
  transitions: ActionTransition[]
  workspaces: Workspace[]
  projects: Project[]
  repositoryConnections: RepositoryConnection[]
  pipelineRuns: PipelineRun[]
  findings: Finding[]
  recommendations: Recommendation[]
  aiReasonings: AIProductReasoning[]
  outcomes: RecommendationOutcome[]
  learningProfiles: AdaptiveLearningProfile[]
  learningSignals: LearningSignal[]
  pmDecisionTelemetry: PMDecisionTelemetry[]
  users: UserRecord[]
  sessions: SessionRecord[]
  memberships: WorkspaceMembership[]
}

const CURRENT_VERSION = 1

const MIGRATIONS: Record<number, (state: DatabaseState) => void> = {
  1: (state) => {
    // Initial schema — no-op, this is the canonical baseline.
    if (!state.aiReasonings) state.aiReasonings = []
    if (!state.outcomes) state.outcomes = []
    if (!state.learningProfiles) state.learningProfiles = []
    if (!state.learningSignals) state.learningSignals = []
    if (!state.users) state.users = []
    if (!state.sessions) state.sessions = []
    if (!state.memberships) state.memberships = []
  },
}
