/**
 * ScheduledIntelligenceService test suite (V2.1)
 */
import { describe, it, expect } from 'vitest'
import { ScheduledIntelligenceService } from '../ScheduledIntelligenceService'
import type { ScheduledJobRepository } from '../../../domain/repositories/ScheduledJobRepository'
import type { ProductRepository } from '../../../domain/repositories/ProductRepository'
import type {
  ScheduledJob,
  JobExecution,
  JobMetrics,
} from '../../../domain/entities/ScheduledIntelligence'

function mockJobRepository(): ScheduledJobRepository {
  const jobs: ScheduledJob[] = []
  const executions: JobExecution[] = []
  const metrics: JobMetrics[] = []

  return {
    saveJob: async (job: ScheduledJob) => {
      const idx = jobs.findIndex((j) => j.id === job.id)
      if (idx >= 0) jobs[idx] = job
      else jobs.push(job)
    },
    getJobById: async (id: string, wsId: string, pId: string) =>
      jobs.find((j) => j.id === id && j.workspaceId === wsId && j.projectId === pId) ?? null,
    getJobsByProject: async (pId: string, wsId: string) =>
      jobs.filter((j) => j.projectId === pId && j.workspaceId === wsId),
    getJobsByStatus: async (status, pId, wsId) =>
      jobs.filter((j) => j.status === status && j.projectId === pId && j.workspaceId === wsId),
    deleteJob: async (id, wsId, pId) => {
      const idx = jobs.findIndex(
        (j) => j.id === id && j.workspaceId === wsId && j.projectId === pId
      )
      if (idx >= 0) jobs.splice(idx, 1)
    },
    saveExecution: async (exec: JobExecution) => {
      const idx = executions.findIndex((e) => e.id === exec.id)
      if (idx >= 0) executions[idx] = exec
      else executions.push(exec)
    },
    getExecutionById: async (id, wsId, pId) =>
      executions.find((e) => e.id === id && e.workspaceId === wsId && e.projectId === pId) ?? null,
    getExecutionsByJob: async (jobId, wsId, pId) =>
      executions.filter((e) => e.jobId === jobId && e.workspaceId === wsId && e.projectId === pId),
    getExecutionsByProject: async (pId, wsId) =>
      executions.filter((e) => e.projectId === pId && e.workspaceId === wsId),
    getRecentExecutions: async (jobId, wsId, pId, limit) =>
      executions
        .filter((e) => e.jobId === jobId && e.workspaceId === wsId && e.projectId === pId)
        .slice(0, limit),
    saveMetrics: async (m: JobMetrics) => {
      const idx = metrics.findIndex((x) => x.id === m.id)
      if (idx >= 0) metrics[idx] = m
      else metrics.push(m)
    },
    getMetricsByJob: async (jobId, wsId, pId) =>
      metrics.find((m) => m.jobId === jobId && m.workspaceId === wsId && m.projectId === pId) ??
      null,
    getMetricsByProject: async (pId, wsId) =>
      metrics.filter((m) => m.projectId === pId && m.workspaceId === wsId),
  }
}

function mockProductRepository(projectExists = true): ProductRepository {
  return {
    getProjectByIdAndWorkspace: async () =>
      projectExists ? { id: 'proj-1', workspaceId: 'ws-1', name: 'Test' } : null,
  } as unknown as ProductRepository
}

describe('ScheduledIntelligenceService', () => {
  const wsId = 'ws-1' as import('../../../domain/value-objects').WorkspaceId
  const pId = 'proj-1'

  it('creates a scheduled job with correct defaults', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Daily competitor scan',
      jobType: 'competitor_crawl',
      schedule: { cronExpression: '0 8 * * *', intervalMs: null, oneTimeAt: null },
    })

    expect(job.name).toBe('Daily competitor scan')
    expect(job.jobType).toBe('competitor_crawl')
    expect(job.status).toBe('active')
    expect(job.totalExecutions).toBe(0)
    expect(job.retryPolicy.maxRetries).toBe(3)
    expect(job.retryPolicy.initialBackoffMs).toBe(5_000)
    expect(job.nextRunAt).not.toBeNull()
  })

  it('rejects creation when project ownership fails', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository(false))

    await expect(
      service.createJob(wsId, pId, {
        name: 'Orphan job',
        jobType: 'pricing_scan',
        schedule: { cronExpression: null, intervalMs: 3600_000, oneTimeAt: null },
      })
    ).rejects.toThrow(/ownership verification failed/)
  })

  it('lists jobs by project', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    await service.createJob(wsId, pId, {
      name: 'Job A',
      jobType: 'competitor_crawl',
      schedule: { cronExpression: '0 * * * *', intervalMs: null, oneTimeAt: null },
    })
    await service.createJob(wsId, pId, {
      name: 'Job B',
      jobType: 'pricing_scan',
      schedule: { cronExpression: null, intervalMs: 600_000, oneTimeAt: null },
    })

    const jobs = await service.getJobsByProject(wsId, pId)
    expect(jobs).toHaveLength(2)
    expect(jobs.map((j) => j.name)).toContain('Job A')
    expect(jobs.map((j) => j.name)).toContain('Job B')
  })

  it('pauses and resumes a job', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Pausable job',
      jobType: 'ux_analysis',
      schedule: { cronExpression: '0 * * * *', intervalMs: null, oneTimeAt: null },
    })

    const paused = await service.pauseJob(wsId, pId, job.id)
    expect(paused.status).toBe('paused')
    expect(paused.nextRunAt).toBeNull()

    const resumed = await service.resumeJob(wsId, pId, job.id)
    expect(resumed.status).toBe('active')
    expect(resumed.nextRunAt).not.toBeNull()
  })

  it('triggers a manual execution', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Manual trigger job',
      jobType: 'changelog_scan',
      schedule: { cronExpression: null, intervalMs: 3600_000, oneTimeAt: null },
    })

    const exec = await service.triggerExecution(wsId, pId, job.id, 'manual')
    expect(exec.status).toBe('running')
    expect(exec.trigger).toBe('manual')
    expect(exec.attemptNumber).toBe(1)
  })

  it('completes an execution and updates metrics', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Metrics job',
      jobType: 'documentation_scan',
      schedule: { cronExpression: null, intervalMs: 3600_000, oneTimeAt: null },
    })

    const exec = await service.triggerExecution(wsId, pId, job.id, 'manual')
    const completed = await service.completeExecution(wsId, pId, exec.id, true, { pages: 5 }, null)

    expect(completed.status).toBe('completed')
    expect(completed.durationMs).toBeGreaterThanOrEqual(0)
    expect(completed.result).toEqual({ pages: 5 })
    expect(completed.error).toBeNull()

    const metrics = await service.getMetrics(wsId, pId, job.id)
    expect(metrics).not.toBeNull()
    expect(metrics!.totalExecutions).toBe(1)
    expect(metrics!.successfulExecutions).toBe(1)
    expect(metrics!.failedExecutions).toBe(0)
  })

  it('handles failure and auto-pauses after max consecutive failures', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Fail job',
      jobType: 'competitor_crawl',
      schedule: { cronExpression: null, intervalMs: 3600_000, oneTimeAt: null },
      maxConsecutiveFailures: 2,
    })

    // First failure
    const exec1 = await service.triggerExecution(wsId, pId, job.id, 'manual')
    await service.completeExecution(wsId, pId, exec1.id, false, null, 'Network error')

    const jobAfterFirst = await service.getJob(wsId, pId, job.id)
    expect(jobAfterFirst!.consecutiveFailures).toBe(1)
    expect(jobAfterFirst!.status).toBe('active') // not yet paused

    // Second failure — should auto-pause
    const exec2 = await service.triggerExecution(wsId, pId, job.id, 'retry')
    await service.completeExecution(wsId, pId, exec2.id, false, null, 'Timeout')

    const jobAfterSecond = await service.getJob(wsId, pId, job.id)
    expect(jobAfterSecond!.consecutiveFailures).toBe(2)
    expect(jobAfterSecond!.status).toBe('paused')
  })

  it('resets consecutive failures on success', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Recovery job',
      jobType: 'pricing_scan',
      schedule: { cronExpression: null, intervalMs: 3600_000, oneTimeAt: null },
      maxConsecutiveFailures: 3,
    })

    const exec1 = await service.triggerExecution(wsId, pId, job.id, 'manual')
    await service.completeExecution(wsId, pId, exec1.id, false, null, 'Error')
    const exec2 = await service.triggerExecution(wsId, pId, job.id, 'retry')
    await service.completeExecution(wsId, pId, exec2.id, false, null, 'Error')

    const jobAfterFailures = await service.getJob(wsId, pId, job.id)
    expect(jobAfterFailures!.consecutiveFailures).toBe(2)

    const exec3 = await service.triggerExecution(wsId, pId, job.id, 'manual')
    await service.completeExecution(wsId, pId, exec3.id, true, { ok: true }, null)

    const jobAfterSuccess = await service.getJob(wsId, pId, job.id)
    expect(jobAfterSuccess!.consecutiveFailures).toBe(0)
    expect(jobAfterSuccess!.status).toBe('active')
  })

  it('schedules retry with exponential backoff on failure', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Retry job',
      jobType: 'competitor_crawl',
      schedule: { cronExpression: null, intervalMs: 3600_000, oneTimeAt: null },
      retryPolicy: {
        maxRetries: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30_000,
        backoffMultiplier: 2,
      },
    })

    const exec = await service.triggerExecution(wsId, pId, job.id, 'manual')
    const before = Date.now()
    await service.completeExecution(wsId, pId, exec.id, false, null, 'Transient')

    const updatedJob = await service.getJob(wsId, pId, job.id)
    expect(updatedJob!.nextRunAt).not.toBeNull()
    const nextRunMs = new Date(updatedJob!.nextRunAt!).getTime()
    // Should be roughly 1s from now (initialBackoffMs)
    expect(nextRunMs - before).toBeGreaterThanOrEqual(900)
    expect(nextRunMs - before).toBeLessThanOrEqual(2000)
  })

  it('computes correct next run for cron schedule', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Cron job',
      jobType: 'competitor_crawl',
      schedule: { cronExpression: '0 */6 * * *', intervalMs: null, oneTimeAt: null },
    })

    expect(job.nextRunAt).not.toBeNull()
    const next = new Date(job.nextRunAt!)
    // The hour should be a multiple of 6
    expect(next.getUTCHours() % 6).toBe(0)
    expect(next.getUTCMinutes()).toBe(0)
  })

  it('computes correct next run for interval schedule', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Interval job',
      jobType: 'pricing_scan',
      schedule: { cronExpression: null, intervalMs: 3_600_000, oneTimeAt: null },
    })

    expect(job.nextRunAt).not.toBeNull()
    const next = new Date(job.nextRunAt!)
    const diff = next.getTime() - Date.now()
    // Should be roughly 1 hour from now
    expect(diff).toBeGreaterThanOrEqual(3_500_000)
    expect(diff).toBeLessThanOrEqual(3_700_000)
  })

  it('deletes a job and its associated data', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    const job = await service.createJob(wsId, pId, {
      name: 'Deletable',
      jobType: 'changelog_scan',
      schedule: { cronExpression: null, intervalMs: 3600_000, oneTimeAt: null },
    })

    await service.deleteJob(wsId, pId, job.id)
    const deleted = await service.getJob(wsId, pId, job.id)
    expect(deleted).toBeNull()
  })

  it('returns jobs due for execution', async () => {
    const repo = mockJobRepository()
    const service = new ScheduledIntelligenceService(repo, mockProductRepository())

    // Create a job with a cron schedule (will have a valid nextRunAt)
    const job = await service.createJob(wsId, pId, {
      name: 'Due job',
      jobType: 'competitor_crawl',
      schedule: {
        cronExpression: null,
        intervalMs: 3_600_000,
        oneTimeAt: null,
      },
    })

    // Manually set nextRunAt to the past to simulate a due job
    await repo.saveJob({ ...job, nextRunAt: new Date(Date.now() - 60_000).toISOString() })

    // Create a job that's not yet due
    await service.createJob(wsId, pId, {
      name: 'Future job',
      jobType: 'pricing_scan',
      schedule: {
        cronExpression: null,
        intervalMs: 3_600_000,
        oneTimeAt: null,
      },
    })

    const dueJobs = await service.getJobsDueForExecution(wsId, pId)
    expect(dueJobs.length).toBeGreaterThanOrEqual(1)
    expect(dueJobs.some((j) => j.name === 'Due job')).toBe(true)
    expect(dueJobs.some((j) => j.name === 'Future job')).toBe(false)
  })
})
