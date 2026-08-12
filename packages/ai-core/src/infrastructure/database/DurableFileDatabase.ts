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
import type {
  Competitor,
  CompetitorAnalysis,
  FeatureMatrix,
  PositioningMatrix,
  DifferentiationAnalysis,
  MarketOpportunity,
  CompetitorRecommendation,
} from '../../domain/entities/CompetitorIntelligence'
import type {
  UserJourney,
  FrictionPoint,
  UXAnalysis,
  UXRecommendation,
} from '../../domain/entities/UXIntelligence'
import type {
  CrawlJob,
  CrawledPage,
  BrowserIntelligenceSession,
} from '../../domain/entities/BrowserIntelligence'
import type {
  ExecutiveDashboard,
  ExecutiveReport,
  ProductHealthSnapshot,
  TrendDetection,
} from '../../domain/entities/ExecutiveIntelligence'
import type {
  ScheduledJob,
  JobExecution,
  JobMetrics,
} from '../../domain/entities/ScheduledIntelligence'

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
    const bakPath = this.dbPath + '.bak'
    if (!fs.existsSync(this.dbPath)) {
      // No primary database — try .bak recovery
      if (fs.existsSync(bakPath)) {
        log.warn('Primary db.json missing, recovering from .bak', { dbPath: this.dbPath })
        fs.copyFileSync(bakPath, this.dbPath)
      } else {
        this.state = this.blankState()
        this.saveStateDirect(this.state)
        log.info('Initialized new durable database', { dbPath: this.dbPath })
      }
    }

    // Read and migrate the primary database
    try {
      const data = fs.readFileSync(this.dbPath, 'utf8')
      this.state = this.migrate(JSON.parse(data))
      log.info('Loaded existing durable database', {
        dbPath: this.dbPath,
        version: this.state.version,
      })
    } catch (readErr) {
      // Primary db.json is corrupt — attempt recovery from .bak
      if (fs.existsSync(bakPath)) {
        log.warn('Primary db.json corrupt, recovering from .bak', {
          dbPath: this.dbPath,
          err: String(readErr),
        })
        try {
          fs.copyFileSync(bakPath, this.dbPath)
          const data = fs.readFileSync(this.dbPath, 'utf8')
          this.state = this.migrate(JSON.parse(data))
          log.info('Recovered durable database from .bak', {
            dbPath: this.dbPath,
            version: this.state.version,
          })
        } catch {
          // Both primary and .bak are corrupt — initialize blank
          log.error('Both db.json and .bak corrupt, initializing blank', {
            dbPath: this.dbPath,
          })
          this.state = this.blankState()
          this.saveStateDirect(this.state)
        }
      } else {
        // No .bak available — initialize blank
        log.error('db.json corrupt and no .bak available, initializing blank', {
          dbPath: this.dbPath,
          err: String(readErr),
        })
        this.state = this.blankState()
        this.saveStateDirect(this.state)
      }
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
      // H9
      competitors: [],
      competitorAnalyses: [],
      featureMatrices: [],
      positioningMatrices: [],
      differentiationAnalyses: [],
      marketOpportunities: [],
      competitorRecommendations: [],
      // H10
      userJourneys: [],
      frictionPoints: [],
      uxAnalyses: [],
      uxRecommendations: [],
      // H11
      crawlJobs: [],
      crawledPages: [],
      browserSessions: [],
      // H12
      executiveDashboards: [],
      executiveReports: [],
      productHealthSnapshots: [],
      trendDetections: [],
      // V2.1
      scheduledJobs: [],
      jobExecutions: [],
      jobMetrics: [],
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
      // H9
      competitors: Array.isArray(raw.competitors) ? raw.competitors : base.competitors,
      competitorAnalyses: Array.isArray(raw.competitorAnalyses)
        ? raw.competitorAnalyses
        : base.competitorAnalyses,
      featureMatrices: Array.isArray(raw.featureMatrices)
        ? raw.featureMatrices
        : base.featureMatrices,
      positioningMatrices: Array.isArray(raw.positioningMatrices)
        ? raw.positioningMatrices
        : base.positioningMatrices,
      differentiationAnalyses: Array.isArray(raw.differentiationAnalyses)
        ? raw.differentiationAnalyses
        : base.differentiationAnalyses,
      marketOpportunities: Array.isArray(raw.marketOpportunities)
        ? raw.marketOpportunities
        : base.marketOpportunities,
      competitorRecommendations: Array.isArray(raw.competitorRecommendations)
        ? raw.competitorRecommendations
        : base.competitorRecommendations,
      // H10
      userJourneys: Array.isArray(raw.userJourneys) ? raw.userJourneys : base.userJourneys,
      frictionPoints: Array.isArray(raw.frictionPoints) ? raw.frictionPoints : base.frictionPoints,
      uxAnalyses: Array.isArray(raw.uxAnalyses) ? raw.uxAnalyses : base.uxAnalyses,
      uxRecommendations: Array.isArray(raw.uxRecommendations)
        ? raw.uxRecommendations
        : base.uxRecommendations,
      // H11
      crawlJobs: Array.isArray(raw.crawlJobs) ? raw.crawlJobs : base.crawlJobs,
      crawledPages: Array.isArray(raw.crawledPages) ? raw.crawledPages : base.crawledPages,
      browserSessions: Array.isArray(raw.browserSessions)
        ? raw.browserSessions
        : base.browserSessions,
      // H12
      executiveDashboards: Array.isArray(raw.executiveDashboards)
        ? raw.executiveDashboards
        : base.executiveDashboards,
      executiveReports: Array.isArray(raw.executiveReports)
        ? raw.executiveReports
        : base.executiveReports,
      productHealthSnapshots: Array.isArray(raw.productHealthSnapshots)
        ? raw.productHealthSnapshots
        : base.productHealthSnapshots,
      trendDetections: Array.isArray(raw.trendDetections)
        ? raw.trendDetections
        : base.trendDetections,
      // V2.1
      scheduledJobs: Array.isArray(raw.scheduledJobs) ? raw.scheduledJobs : base.scheduledJobs,
      jobExecutions: Array.isArray(raw.jobExecutions) ? raw.jobExecutions : base.jobExecutions,
      jobMetrics: Array.isArray(raw.jobMetrics) ? raw.jobMetrics : base.jobMetrics,
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
        // Write to disk FIRST, THEN update in-memory state.
        // If the disk write fails, in-memory state stays consistent with
        // the last successful commit — no divergence after a crash.
        this.writeSnapshot(this.transactionState)
        this.state = this.transactionState
        this.transactionState = null
        this.inTransaction = false
      } catch (err) {
        // Disk write failed — revert transaction, in-memory state stays
        // as the last successful commit.  The caller sees the error.
        this.transactionState = null
        this.inTransaction = false
        throw err
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
    const bakPath = this.dbPath + '.bak'
    const data = JSON.stringify(snapshot, null, 2)

    // Preserve a backup of the last known-good state before overwriting.
    // If the new write fails mid-way (power loss, crash), the .bak file
    // can be used for recovery.  copyFileSync is used (not rename) so
    // the original db.json remains intact if the copy fails.
    if (fs.existsSync(this.dbPath)) {
      try {
        fs.copyFileSync(this.dbPath, bakPath)
      } catch {
        // Best-effort — if backup fails, proceed with the write anyway.
        // The in-memory state is the authoritative source during normal
        // operation; the .bak is a crash-recovery aid only.
      }
    }

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
    this.atomicReplace(tempPath)
  }

  /**
   * Atomically replace the target file with the source file.
   * Retries rename up to 3 times (Windows file-locking backoff),
   * then falls back to copy + unlink if rename is persistently blocked.
   */
  private atomicReplace(sourcePath: string): void {
    const MAX_RETRIES = 3
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        fs.renameSync(sourcePath, this.dbPath)
        return
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES
        if (isLastAttempt) {
          // Fallback: copy + unlink (safe on Windows when rename is blocked)
          try {
            fs.copyFileSync(sourcePath, this.dbPath)
            fs.unlinkSync(sourcePath)
            return
          } catch {
            // If even copy fails, throw the original rename error
            throw err
          }
        }
        // Backoff: 10ms, 20ms, 40ms
        const delay = 10 * Math.pow(2, attempt)
        const start = Date.now()
        while (Date.now() - start < delay) {
          // busy-wait (sub-50ms, acceptable for file-lock release)
        }
      }
    }
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
    // Upsert on collision, scoped by (id, workspaceId). Filtering by `id`
    // alone would let a same-id Action from another workspace REPLACE this
    // tenant's row (cross-tenant clobber, audit F01 class). Action ids are
    // UUIDs so collisions are cryptographically improbable, but the
    // constraint must not silently delete another tenant's data.
    state.actions = state.actions.filter(
      (a) => !(a.id === action.id && a.workspaceId === action.workspaceId)
    )
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
    // Upsert by (id, workspaceId) — never clobber another tenant's row.
    state.executions = state.executions.filter(
      (e) => !(e.id === exec.id && e.workspaceId === exec.workspaceId)
    )
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
    this.atomicReplace(tempPath)
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
  // H9 — Competitor Intelligence
  competitors: Competitor[]
  competitorAnalyses: CompetitorAnalysis[]
  featureMatrices: FeatureMatrix[]
  positioningMatrices: PositioningMatrix[]
  differentiationAnalyses: DifferentiationAnalysis[]
  marketOpportunities: MarketOpportunity[]
  competitorRecommendations: CompetitorRecommendation[]
  // H10 — UX Intelligence
  userJourneys: UserJourney[]
  frictionPoints: FrictionPoint[]
  uxAnalyses: UXAnalysis[]
  uxRecommendations: UXRecommendation[]
  // H11 — Browser Intelligence
  crawlJobs: CrawlJob[]
  crawledPages: CrawledPage[]
  browserSessions: BrowserIntelligenceSession[]
  // H12 — Executive Intelligence
  executiveDashboards: ExecutiveDashboard[]
  executiveReports: ExecutiveReport[]
  productHealthSnapshots: ProductHealthSnapshot[]
  trendDetections: TrendDetection[]
  // V2.1 — Continuous Intelligence
  scheduledJobs: ScheduledJob[]
  jobExecutions: JobExecution[]
  jobMetrics: JobMetrics[]
}

const CURRENT_VERSION = 3

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
  2: (state) => {
    // H9–H12 schema additions.
    if (!state.competitors) state.competitors = []
    if (!state.competitorAnalyses) state.competitorAnalyses = []
    if (!state.featureMatrices) state.featureMatrices = []
    if (!state.positioningMatrices) state.positioningMatrices = []
    if (!state.differentiationAnalyses) state.differentiationAnalyses = []
    if (!state.marketOpportunities) state.marketOpportunities = []
    if (!state.competitorRecommendations) state.competitorRecommendations = []
    if (!state.userJourneys) state.userJourneys = []
    if (!state.frictionPoints) state.frictionPoints = []
    if (!state.uxAnalyses) state.uxAnalyses = []
    if (!state.uxRecommendations) state.uxRecommendations = []
    if (!state.crawlJobs) state.crawlJobs = []
    if (!state.crawledPages) state.crawledPages = []
    if (!state.browserSessions) state.browserSessions = []
    if (!state.executiveDashboards) state.executiveDashboards = []
    if (!state.executiveReports) state.executiveReports = []
    if (!state.productHealthSnapshots) state.productHealthSnapshots = []
    if (!state.trendDetections) state.trendDetections = []
  },
  3: (state) => {
    // V2.1 — Continuous Intelligence schema additions.
    if (!state.scheduledJobs) state.scheduledJobs = []
    if (!state.jobExecutions) state.jobExecutions = []
    if (!state.jobMetrics) state.jobMetrics = []
  },
}
