/**
 * ScheduledIntelligence domain entities (V2.1)
 *
 * Models recurring intelligence collection jobs, their individual executions,
 * and aggregated execution metrics. Supports cron scheduling, manual triggers,
 * retry with exponential backoff, and cancellation.
 */
import type { WorkspaceId } from '../value-objects'

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type JobType =
  'competitor_crawl' | 'ux_analysis' | 'documentation_scan' | 'pricing_scan' | 'changelog_scan'

export type ScheduledJobStatus = 'active' | 'paused' | 'completed' | 'failed'

export type JobExecutionStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retry_pending'

export type TriggerSource = 'cron' | 'manual' | 'retry'

// ---------------------------------------------------------------------------
// Schedule configuration
// ---------------------------------------------------------------------------

export interface ScheduleConfig {
  /** Cron expression (e.g. "0 \*\/6 \* \* \*") — null when using intervalMs */
  cronExpression: string | null
  /** Interval in milliseconds — null when using cronExpression */
  intervalMs: number | null
  /** ISO date string — set for one-time future runs */
  oneTimeAt: string | null
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Maximum number of retry attempts (0 = no retries) */
  maxRetries: number
  /** Initial backoff delay in milliseconds */
  initialBackoffMs: number
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number
  /** Multiplier applied to backoff on each retry */
  backoffMultiplier: number
}

// ---------------------------------------------------------------------------
// Scheduled job
// ---------------------------------------------------------------------------

export interface ScheduledJob {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  /** Human-readable job name */
  name: string
  /** What type of intelligence to collect */
  jobType: JobType
  /** Schedule configuration (cron, interval, or one-time) */
  schedule: ScheduleConfig
  /** Retry policy for failed executions */
  retryPolicy: RetryPolicy
  /** Current job status */
  status: ScheduledJobStatus
  /** Total number of times this job has been executed */
  totalExecutions: number
  /** Number of consecutive failures before auto-pause */
  consecutiveFailures: number
  /** Maximum consecutive failures before auto-pause (0 = never auto-pause) */
  maxConsecutiveFailures: number
  /** ISO date string of the last execution */
  lastExecutedAt: string | null
  /** ISO date string of the next scheduled execution */
  nextRunAt: string | null
  /** ISO date string when this job was created */
  createdAt: string
  /** ISO date string when this job was last updated */
  updatedAt: string
  /** Optional metadata specific to the job type (URLs, targets, etc.) */
  config: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

export interface JobExecution {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  /** Reference to the scheduled job */
  jobId: string
  /** What triggered this execution */
  trigger: TriggerSource
  /** Current execution status */
  status: JobExecutionStatus
  /** ISO date string when execution started */
  startedAt: string
  /** ISO date string when execution completed (null if still running) */
  completedAt: string | null
  /** Duration in milliseconds (null if still running) */
  durationMs: number | null
  /** Execution result summary */
  result: Record<string, unknown> | null
  /** Error message if the execution failed */
  error: string | null
  /** Which attempt this is (1 = initial, 2+ = retries) */
  attemptNumber: number
  /** ISO date string when this execution was created */
  createdAt: string
}

// ---------------------------------------------------------------------------
// Job metrics (aggregated)
// ---------------------------------------------------------------------------

export interface JobMetrics {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  /** Reference to the scheduled job */
  jobId: string
  /** Total number of executions */
  totalExecutions: number
  /** Number of successful executions */
  successfulExecutions: number
  /** Number of failed executions */
  failedExecutions: number
  /** Number of cancelled executions */
  cancelledExecutions: number
  /** Average execution duration in milliseconds (0 if no completed executions) */
  averageDurationMs: number
  /** Total execution duration in milliseconds */
  totalDurationMs: number
  /** ISO date string of the last successful execution */
  lastSuccessAt: string | null
  /** ISO date string of the last failed execution */
  lastFailureAt: string | null
  /** ISO date string when metrics were last updated */
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateScheduledJob(j: ScheduledJob): void {
  if (!j.id || !j.id.trim()) throw new Error('ScheduledJob must have a valid id')
  if (!j.workspaceId || !j.workspaceId.trim())
    throw new Error('ScheduledJob must have a workspaceId')
  if (!j.projectId || !j.projectId.trim()) throw new Error('ScheduledJob must have a projectId')
  if (!j.name || !j.name.trim()) throw new Error('ScheduledJob must have a name')
  if (!j.jobType) throw new Error('ScheduledJob must have a jobType')
  if (!j.schedule) throw new Error('ScheduledJob must have a schedule')
  if (!j.retryPolicy) throw new Error('ScheduledJob must have a retryPolicy')
}

export function validateJobExecution(e: JobExecution): void {
  if (!e.id || !e.id.trim()) throw new Error('JobExecution must have a valid id')
  if (!e.workspaceId || !e.workspaceId.trim())
    throw new Error('JobExecution must have a workspaceId')
  if (!e.projectId || !e.projectId.trim()) throw new Error('JobExecution must have a projectId')
  if (!e.jobId || !e.jobId.trim()) throw new Error('JobExecution must reference a jobId')
  if (!e.trigger) throw new Error('JobExecution must have a trigger')
  if (!e.status) throw new Error('JobExecution must have a status')
}

export function validateJobMetrics(m: JobMetrics): void {
  if (!m.id || !m.id.trim()) throw new Error('JobMetrics must have a valid id')
  if (!m.workspaceId || !m.workspaceId.trim()) throw new Error('JobMetrics must have a workspaceId')
  if (!m.projectId || !m.projectId.trim()) throw new Error('JobMetrics must have a projectId')
  if (!m.jobId || !m.jobId.trim()) throw new Error('JobMetrics must reference a jobId')
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function createScheduledJob(
  data: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string
    createdAt?: string
    updatedAt?: string
  }
): ScheduledJob {
  const now = new Date().toISOString()
  const j: ScheduledJob = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    name: data.name,
    jobType: data.jobType,
    schedule: data.schedule,
    retryPolicy: data.retryPolicy,
    status: data.status ?? 'active',
    totalExecutions: data.totalExecutions ?? 0,
    consecutiveFailures: data.consecutiveFailures ?? 0,
    maxConsecutiveFailures: data.maxConsecutiveFailures ?? 5,
    lastExecutedAt: data.lastExecutedAt ?? null,
    nextRunAt: data.nextRunAt ?? null,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    config: data.config ?? {},
  }
  validateScheduledJob(j)
  return j
}

export function createJobExecution(
  data: Omit<JobExecution, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: string
  }
): JobExecution {
  const e: JobExecution = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    jobId: data.jobId,
    trigger: data.trigger,
    status: data.status,
    startedAt: data.startedAt,
    completedAt: data.completedAt ?? null,
    durationMs: data.durationMs ?? null,
    result: data.result ?? null,
    error: data.error ?? null,
    attemptNumber: data.attemptNumber ?? 1,
    createdAt: data.createdAt ?? new Date().toISOString(),
  }
  validateJobExecution(e)
  return e
}

export function createJobMetrics(
  data: Omit<JobMetrics, 'id' | 'updatedAt'> & {
    id?: string
    updatedAt?: string
  }
): JobMetrics {
  const m: JobMetrics = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    jobId: data.jobId,
    totalExecutions: data.totalExecutions ?? 0,
    successfulExecutions: data.successfulExecutions ?? 0,
    failedExecutions: data.failedExecutions ?? 0,
    cancelledExecutions: data.cancelledExecutions ?? 0,
    averageDurationMs: data.averageDurationMs ?? 0,
    totalDurationMs: data.totalDurationMs ?? 0,
    lastSuccessAt: data.lastSuccessAt ?? null,
    lastFailureAt: data.lastFailureAt ?? null,
    updatedAt: data.updatedAt ?? new Date().toISOString(),
  }
  validateJobMetrics(m)
  return m
}

/**
 * Simple cron expression parser for scheduling.
 * Returns the next run time for a cron expression relative to the given date.
 * Supports: minute hour dayOfMonth month dayOfWeek
 * Does not support: ranges (e.g. 1-5), steps (e.g. star-slash-5), or special strings (@daily).
 */
export function getNextCronRun(cronExpression: string, after: Date): Date | null {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts

  const next = new Date(after.getTime() + 60_000) // start from next minute
  // Cap search at 366 days to avoid infinite loops
  const maxSearch = new Date(after.getTime() + 366 * 24 * 60 * 60_000)

  while (next <= maxSearch) {
    const dom = next.getUTCDate()
    const month = next.getUTCMonth() + 1 // 1-based
    const dow = next.getUTCDay() // 0=Sun
    const hour = next.getUTCHours()
    const minute = next.getUTCMinutes()

    if (
      matchCronField(domExpr, dom, 1, 31) &&
      matchCronField(monthExpr, month, 1, 12) &&
      matchCronField(dowExpr, dow, 0, 6) &&
      matchCronField(hourExpr, hour, 0, 23) &&
      matchCronField(minuteExpr, minute, 0, 59)
    ) {
      return next
    }
    next.setTime(next.getTime() + 60_000)
  }
  return null
}

function matchCronField(field: string, value: number, min: number, _max: number): boolean {
  if (field === '*') return true
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10)
    if (isNaN(step) || step <= 0) return false
    return (value - min) % step === 0
  }
  if (field.includes(',')) {
    return field.split(',').some((v) => parseInt(v.trim(), 10) === value)
  }
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map((v) => parseInt(v.trim(), 10))
    return value >= lo && value <= hi
  }
  return parseInt(field, 10) === value
}

/**
 * Compute the next run time for a schedule configuration.
 */
export function computeNextRun(schedule: ScheduleConfig, after: Date): string | null {
  if (schedule.oneTimeAt) {
    const d = new Date(schedule.oneTimeAt)
    return d > after ? d.toISOString() : null
  }
  if (schedule.cronExpression) {
    const next = getNextCronRun(schedule.cronExpression, after)
    return next ? next.toISOString() : null
  }
  if (schedule.intervalMs && schedule.intervalMs > 0) {
    return new Date(after.getTime() + schedule.intervalMs).toISOString()
  }
  return null
}
