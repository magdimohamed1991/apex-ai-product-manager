/**
 * ScheduledIntelligenceService — V2.1 Continuous Intelligence orchestrator.
 *
 * Manages recurring intelligence collection jobs: creation, manual triggering,
 * cron/interval scheduling, retry with exponential backoff, cancellation,
 * execution history, and metrics aggregation.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { ScheduledJobRepository } from '../../domain/repositories/ScheduledJobRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type {
  ScheduledJob,
  JobExecution,
  JobMetrics,
  ScheduleConfig,
  RetryPolicy,
  JobType,
  TriggerSource,
} from '../../domain/entities/ScheduledIntelligence'
import {
  createScheduledJob,
  createJobExecution,
  createJobMetrics,
  computeNextRun,
} from '../../domain/entities/ScheduledIntelligence'

export interface CreateScheduledJobInput {
  name: string
  jobType: JobType
  schedule: ScheduleConfig
  retryPolicy?: Partial<RetryPolicy>
  maxConsecutiveFailures?: number
  config?: Record<string, unknown>
}

export interface UpdateScheduledJobInput {
  name?: string
  schedule?: ScheduleConfig
  retryPolicy?: Partial<RetryPolicy>
  maxConsecutiveFailures?: number
  config?: Record<string, unknown>
}

export class ScheduledIntelligenceService {
  constructor(
    private readonly scheduledJobRepository: ScheduledJobRepository,
    private readonly productRepository: ProductRepository
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async createJob(
    workspaceId: WorkspaceId,
    projectId: string,
    input: CreateScheduledJobInput
  ): Promise<ScheduledJob> {
    await this.verifyProjectOwnership(workspaceId, projectId)

    const retryPolicy: RetryPolicy = {
      maxRetries: input.retryPolicy?.maxRetries ?? 3,
      initialBackoffMs: input.retryPolicy?.initialBackoffMs ?? 5_000,
      maxBackoffMs: input.retryPolicy?.maxBackoffMs ?? 60_000,
      backoffMultiplier: input.retryPolicy?.backoffMultiplier ?? 2,
    }

    const now = new Date()
    const nextRunAt = computeNextRun(input.schedule, now)

    const job = createScheduledJob({
      workspaceId,
      projectId,
      name: input.name,
      jobType: input.jobType,
      schedule: input.schedule,
      retryPolicy,
      status: 'active',
      totalExecutions: 0,
      consecutiveFailures: 0,
      maxConsecutiveFailures: input.maxConsecutiveFailures ?? 5,
      lastExecutedAt: null,
      nextRunAt,
      config: input.config ?? {},
    })

    await this.scheduledJobRepository.saveJob(job)
    return job
  }

  async updateJob(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string,
    input: UpdateScheduledJobInput
  ): Promise<ScheduledJob> {
    await this.verifyProjectOwnership(workspaceId, projectId)

    const existing = await this.scheduledJobRepository.getJobById(jobId, workspaceId, projectId)
    if (!existing) {
      throw new Error(`Scheduled job "${jobId}" not found in project "${projectId}"`)
    }

    const updated: ScheduledJob = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.schedule !== undefined && { schedule: input.schedule }),
      ...(input.maxConsecutiveFailures !== undefined && {
        maxConsecutiveFailures: input.maxConsecutiveFailures,
      }),
      ...(input.config !== undefined && { config: input.config }),
      retryPolicy: input.retryPolicy
        ? { ...existing.retryPolicy, ...input.retryPolicy }
        : existing.retryPolicy,
      updatedAt: new Date().toISOString(),
    }

    // Recompute next run if schedule changed
    if (input.schedule) {
      updated.nextRunAt = computeNextRun(input.schedule, new Date())
    }

    await this.scheduledJobRepository.saveJob(updated)
    return updated
  }

  async deleteJob(workspaceId: WorkspaceId, projectId: string, jobId: string): Promise<void> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    await this.scheduledJobRepository.deleteJob(jobId, workspaceId, projectId)
  }

  async getJob(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string
  ): Promise<ScheduledJob | null> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    return this.scheduledJobRepository.getJobById(jobId, workspaceId, projectId)
  }

  async getJobsByProject(workspaceId: WorkspaceId, projectId: string): Promise<ScheduledJob[]> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    return this.scheduledJobRepository.getJobsByProject(projectId, workspaceId)
  }

  // ---------------------------------------------------------------------------
  // Status management
  // ---------------------------------------------------------------------------

  async pauseJob(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string
  ): Promise<ScheduledJob> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const job = await this.scheduledJobRepository.getJobById(jobId, workspaceId, projectId)
    if (!job) throw new Error(`Scheduled job "${jobId}" not found`)

    const updated: ScheduledJob = {
      ...job,
      status: 'paused',
      nextRunAt: null,
      updatedAt: new Date().toISOString(),
    }
    await this.scheduledJobRepository.saveJob(updated)
    return updated
  }

  async resumeJob(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string
  ): Promise<ScheduledJob> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const job = await this.scheduledJobRepository.getJobById(jobId, workspaceId, projectId)
    if (!job) throw new Error(`Scheduled job "${jobId}" not found`)

    const now = new Date()
    const updated: ScheduledJob = {
      ...job,
      status: 'active',
      consecutiveFailures: 0,
      nextRunAt: computeNextRun(job.schedule, now),
      updatedAt: now.toISOString(),
    }
    await this.scheduledJobRepository.saveJob(updated)
    return updated
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Manually trigger a job execution. Also used internally by the scheduler
   * when cron/interval fires.
   */
  async triggerExecution(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string,
    trigger: TriggerSource = 'manual'
  ): Promise<JobExecution> {
    await this.verifyProjectOwnership(workspaceId, projectId)

    const job = await this.scheduledJobRepository.getJobById(jobId, workspaceId, projectId)
    if (!job) throw new Error(`Scheduled job "${jobId}" not found`)
    if (job.status !== 'active' && trigger !== 'manual') {
      throw new Error(`Cannot trigger non-active job "${jobId}" with trigger "${trigger}"`)
    }

    const execution = createJobExecution({
      workspaceId,
      projectId,
      jobId,
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      result: null,
      error: null,
      attemptNumber: 1,
    })

    await this.scheduledJobRepository.saveExecution(execution)
    return execution
  }

  /**
   * Complete an execution with success or failure.
   * Updates metrics and handles retry logic.
   */
  async completeExecution(
    workspaceId: WorkspaceId,
    projectId: string,
    executionId: string,
    success: boolean,
    result: Record<string, unknown> | null,
    error: string | null
  ): Promise<JobExecution> {
    const execution = await this.scheduledJobRepository.getExecutionById(
      executionId,
      workspaceId,
      projectId
    )
    if (!execution) throw new Error(`Job execution "${executionId}" not found`)

    const now = new Date()
    const durationMs = now.getTime() - new Date(execution.startedAt).getTime()

    const completedExecution: JobExecution = {
      ...execution,
      status: success ? 'completed' : 'failed',
      completedAt: now.toISOString(),
      durationMs,
      result: success ? result : null,
      error: success ? null : error,
    }

    await this.scheduledJobRepository.saveExecution(completedExecution)

    // Update metrics
    await this.updateMetrics(workspaceId, projectId, execution.jobId, success, durationMs)

    // Update parent job
    const job = await this.scheduledJobRepository.getJobById(
      execution.jobId,
      workspaceId,
      projectId
    )
    if (job) {
      const newConsecutiveFailures = success ? 0 : job.consecutiveFailures + 1
      const shouldAutoPause =
        job.maxConsecutiveFailures > 0 && newConsecutiveFailures >= job.maxConsecutiveFailures

      const updatedJob: ScheduledJob = {
        ...job,
        totalExecutions: job.totalExecutions + 1,
        consecutiveFailures: newConsecutiveFailures,
        lastExecutedAt: now.toISOString(),
        status: shouldAutoPause ? 'paused' : job.status,
        nextRunAt: shouldAutoPause ? null : computeNextRun(job.schedule, now),
        updatedAt: now.toISOString(),
      }

      // Schedule retry on failure if retries remain AND not auto-paused
      if (
        !success &&
        !shouldAutoPause &&
        job.retryPolicy.maxRetries > 0 &&
        execution.attemptNumber < job.retryPolicy.maxRetries
      ) {
        const backoffMs = Math.min(
          job.retryPolicy.initialBackoffMs *
            Math.pow(job.retryPolicy.backoffMultiplier, execution.attemptNumber - 1),
          job.retryPolicy.maxBackoffMs
        )
        updatedJob.nextRunAt = new Date(now.getTime() + backoffMs).toISOString()
      }

      await this.scheduledJobRepository.saveJob(updatedJob)
    }

    return completedExecution
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getExecutions(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string
  ): Promise<JobExecution[]> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    return this.scheduledJobRepository.getExecutionsByJob(jobId, workspaceId, projectId)
  }

  async getRecentExecutions(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string,
    limit: number = 20
  ): Promise<JobExecution[]> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    return this.scheduledJobRepository.getRecentExecutions(jobId, workspaceId, projectId, limit)
  }

  async getMetrics(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string
  ): Promise<JobMetrics | null> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    return this.scheduledJobRepository.getMetricsByJob(jobId, workspaceId, projectId)
  }

  async getMetricsByProject(workspaceId: WorkspaceId, projectId: string): Promise<JobMetrics[]> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    return this.scheduledJobRepository.getMetricsByProject(projectId, workspaceId)
  }

  async getJobsDueForExecution(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ScheduledJob[]> {
    const activeJobs = await this.scheduledJobRepository.getJobsByStatus(
      'active',
      projectId,
      workspaceId
    )
    const now = new Date()
    return activeJobs.filter((job) => job.nextRunAt && new Date(job.nextRunAt) <= now)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async verifyProjectOwnership(workspaceId: WorkspaceId, projectId: string): Promise<void> {
    const project = await this.productRepository.getProjectByIdAndWorkspace(projectId, workspaceId)
    if (!project) {
      throw new Error(
        `Project "${projectId}" not found in workspace "${workspaceId}" — ownership verification failed`
      )
    }
  }

  private async updateMetrics(
    workspaceId: WorkspaceId,
    projectId: string,
    jobId: string,
    success: boolean,
    durationMs: number
  ): Promise<void> {
    let metrics = await this.scheduledJobRepository.getMetricsByJob(jobId, workspaceId, projectId)

    const now = new Date().toISOString()

    if (!metrics) {
      metrics = createJobMetrics({
        workspaceId,
        projectId,
        jobId,
        totalExecutions: 1,
        successfulExecutions: success ? 1 : 0,
        failedExecutions: success ? 0 : 1,
        cancelledExecutions: 0,
        averageDurationMs: durationMs,
        totalDurationMs: durationMs,
        lastSuccessAt: success ? now : null,
        lastFailureAt: success ? null : now,
      })
    } else {
      const totalExecs = metrics.totalExecutions + 1
      const totalDuration = metrics.totalDurationMs + durationMs
      metrics = {
        ...metrics,
        totalExecutions: totalExecs,
        successfulExecutions: metrics.successfulExecutions + (success ? 1 : 0),
        failedExecutions: metrics.failedExecutions + (success ? 0 : 1),
        averageDurationMs: Math.round(totalDuration / totalExecs),
        totalDurationMs: totalDuration,
        lastSuccessAt: success ? now : metrics.lastSuccessAt,
        lastFailureAt: success ? metrics.lastFailureAt : now,
        updatedAt: now,
      }
    }

    await this.scheduledJobRepository.saveMetrics(metrics)
  }
}
