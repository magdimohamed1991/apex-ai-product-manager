/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />

import * as fs from 'fs'
import * as path from 'path'
import type { Action, Execution, ActionTransition, Project, RepositoryConnection, PipelineRun, Finding, Recommendation, Workspace } from '../../domain/entities'
import { validateAction, validateExecution, validateActionTransitionRecord } from '../../domain/entities'

export interface DatabaseState {
  version: number
  actions: Action[]
  executions: Execution[]
  transitions: ActionTransition[]
  workspaces?: Workspace[]
  projects?: Project[]
  repositoryConnections?: RepositoryConnection[]
  pipelineRuns?: PipelineRun[]
  findings?: Finding[]
  recommendations?: Recommendation[]
  aiReasonings?: unknown[]
  outcomes?: any[]
  learningProfiles?: any[]
  learningSignals?: any[]
}

/**
 * Durable File-Based Relational Database Engine (Milestone D)
 *
 * Implements full ACID-like transactional guarantees via atomic write-ahead temporary
 * file swapping, unique/foreign key constraints, and automatic migration runner.
 * Bypasses native C compilation node-gyp container limits cleanly with pure-TypeScript.
 */
export class DurableFileDatabase {
  private readonly dbPath: string
  private readonly migrationDir: string
  private state: DatabaseState | null = null
  private inTransaction = false
  private transactionState: DatabaseState | null = null

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
   * Initializes the database and runs all migrations deterministically (Item 9)
   */
  async initialize(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      this.state = {
        version: 0,
        actions: [],
        executions: [],
        transitions: [],
        workspaces: [],
        projects: [],
        repositoryConnections: [],
        pipelineRuns: [],
        findings: [],
        recommendations: [],
      }
      this.saveStateDirect(this.state)
    } else {
      const data = fs.readFileSync(this.dbPath, 'utf8')
      this.state = JSON.parse(data)
      if (!this.state!.workspaces) this.state!.workspaces = []
      if (!this.state!.projects) this.state!.projects = []
      if (!this.state!.repositoryConnections) this.state!.repositoryConnections = []
      if (!this.state!.pipelineRuns) this.state!.pipelineRuns = []
      if (!this.state!.findings) this.state!.findings = []
      if (!this.state!.recommendations) this.state!.recommendations = []
      if (!this.state!.aiReasonings) this.state!.aiReasonings = []
      if (!this.state!.outcomes) this.state!.outcomes = []
      if (!this.state!.learningProfiles) this.state!.learningProfiles = []
      if (!this.state!.learningSignals) this.state!.learningSignals = []
    }

    await this.runMigrations()
  }

  /**
   * Begins a database transaction snapshot.
   */
  beginTransaction(): void {
    if (this.inTransaction) {
      throw new Error('Transaction already in progress')
    }
    this.inTransaction = true
    // Deep clone the current state to isolate the transaction snapshot (Item 5)
    this.transactionState = JSON.parse(JSON.stringify(this.state))
  }

  /**
   * Commits the current transaction atomically using file renaming swaps (Item 5)
   */
  async commit(): Promise<void> {
    if (!this.inTransaction || !this.transactionState) {
      throw new Error('No transaction in progress to commit')
    }

    // Atomic File Swap: Write to temp first, then rename (Acid Protection)
    const tempPath = this.dbPath + '.tmp'
    fs.writeFileSync(tempPath, JSON.stringify(this.transactionState, null, 2), 'utf8')
    fs.renameSync(tempPath, this.dbPath)

    this.state = this.transactionState
    this.transactionState = null
    this.inTransaction = false
  }

  /**
   * Discards the transaction snapshot, rolling back changes.
   */
  rollback(): void {
    this.transactionState = null
    this.inTransaction = false
  }

  /**
   * Exposes active table snapshots based on transaction context.
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

  /**
   * Appends a record while enforcing relational integrity & uniqueness constraints.
   */
  insertAction(action: Action): void {
    // Enforce structural domain validation at the database boundary (Item 3)
    validateAction(action)

    const state = this.getActiveState()

    // 1. UNIQUE(workspace_id, idempotency_key) constraint check (Item 3)
    const dupKey = state.actions.some(
      (a) => a.workspaceId === action.workspaceId && a.idempotencyKey === action.idempotencyKey && a.id !== action.id
    )
    if (dupKey) {
      throw new Error(`Unique constraint violation: duplicate idempotencyKey "${action.idempotencyKey}" inside workspace "${action.workspaceId}"`)
    }

    // 2. PRIMARY KEY(id) constraint check (Item 3)
    const dupId = state.actions.some((a) => a.id === action.id)
    if (dupId) {
      // Overwrite/Upsert if already exists (Upsert contract)
      state.actions = state.actions.filter((a) => a.id !== action.id)
    }

    state.actions.push(JSON.parse(JSON.stringify(action)))
  }

  insertExecution(exec: Execution): void {
    // Enforce structural domain validation at the database boundary (Item 3)
    validateExecution(exec)

    const state = this.getActiveState()

    // 1. Foreign Key: execution.action_id -> actions.id (Item 3)
    const actionExists = state.actions.some((a) => a.id === exec.actionId && a.workspaceId === exec.workspaceId)
    if (!actionExists) {
      throw new Error(`Foreign key constraint violation: Action "${exec.actionId}" does not exist in workspace "${exec.workspaceId}"`)
    }

    // 2. PRIMARY KEY(id)
    state.executions = state.executions.filter((e) => e.id !== exec.id)
    state.executions.push(JSON.parse(JSON.stringify(exec)))
  }

  insertTransition(trans: ActionTransition): void {
    // Enforce structural domain validation at the database boundary (Item 3)
    validateActionTransitionRecord(trans)

    const state = this.getActiveState()

    // 1. Foreign Key: transition.action_id -> actions.id
    const actionExists = state.actions.some((a) => a.id === trans.actionId && a.workspaceId === trans.workspaceId)
    if (!actionExists) {
      throw new Error(`Foreign key constraint violation: Action "${trans.actionId}" does not exist in workspace "${trans.workspaceId}"`)
    }

    // 2. UNIQUE(workspace_id, action_id, sequence) constraint check (Item 3)
    const dupSequence = state.transitions.some(
      (t) => t.actionId === trans.actionId && t.workspaceId === trans.workspaceId && t.sequence === trans.sequence
    )
    if (dupSequence) {
      throw new Error(`Unique constraint violation: duplicate sequence "${trans.sequence}" for Action "${trans.actionId}"`)
    }

    state.transitions.push(JSON.parse(JSON.stringify(trans)))
  }

  private saveStateDirect(targetState: DatabaseState): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(targetState, null, 2), 'utf8')
  }

  private async runMigrations(): Promise<void> {
    const state = this.getActiveState()
    
    // Migration 1 setup
    if (state.version < 1) {
      state.version = 1
      this.saveStateDirect(state)
      fs.writeFileSync(
        path.join(this.migrationDir, '001_initial_schema.json'),
        JSON.stringify({ version: 1, description: 'Initial schema tables and constraints created' }, null, 2)
      )
    }
  }
}
