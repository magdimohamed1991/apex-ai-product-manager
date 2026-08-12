/**
 * SqlScheduledJobRepository — V2.1 persistence adapter.
 *
 * Implements the ScheduledJobRepository domain contract against the
 * DurableFileDatabase single-process store. All upserts are scoped by
 * (id, workspaceId, projectId) to preserve multi-tenant isolation.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { ScheduledJobRepository } from '../../domain/repositories/ScheduledJobRepository'
import type {
  ScheduledJob,
  JobExecution,
  JobMetrics,
  ScheduledJobStatus,
} from '../../domain/entities/ScheduledIntelligence'
import type { DurableFileDatabase } from '../database/DurableFileDatabase'

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export class SqlScheduledJobRepository implements ScheduledJobRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  // --- ScheduledJob ---

  async saveJob(job: ScheduledJob): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.scheduledJobs) state.scheduledJobs = []
      state.scheduledJobs = state.scheduledJobs.filter(
        (j) =>
          !(j.id === job.id && j.workspaceId === job.workspaceId && j.projectId === job.projectId)
      )
      state.scheduledJobs.push(deepClone(job))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getJobById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ScheduledJob | null> {
    const state = this.db.getActiveState()
    const j = (state.scheduledJobs ?? []).find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return j ? deepClone(j) : null
  }

  async getJobsByProject(projectId: string, workspaceId: WorkspaceId): Promise<ScheduledJob[]> {
    const state = this.db.getActiveState()
    return (state.scheduledJobs ?? [])
      .filter((j) => j.projectId === projectId && j.workspaceId === workspaceId)
      .map(deepClone)
  }

  async getJobsByStatus(
    status: ScheduledJobStatus,
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ScheduledJob[]> {
    const state = this.db.getActiveState()
    return (state.scheduledJobs ?? [])
      .filter(
        (j) => j.status === status && j.projectId === projectId && j.workspaceId === workspaceId
      )
      .map(deepClone)
  }

  async deleteJob(id: string, workspaceId: WorkspaceId, projectId: string): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.scheduledJobs) state.scheduledJobs = []
      state.scheduledJobs = state.scheduledJobs.filter(
        (j) => !(j.id === id && j.workspaceId === workspaceId && j.projectId === projectId)
      )
      // Also delete related executions and metrics
      if (state.jobExecutions) {
        state.jobExecutions = state.jobExecutions.filter(
          (e) => !(e.jobId === id && e.workspaceId === workspaceId && e.projectId === projectId)
        )
      }
      if (state.jobMetrics) {
        state.jobMetrics = state.jobMetrics.filter(
          (m) => !(m.jobId === id && m.workspaceId === workspaceId && m.projectId === projectId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  // --- JobExecution ---

  async saveExecution(execution: JobExecution): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.jobExecutions) state.jobExecutions = []
      state.jobExecutions = state.jobExecutions.filter(
        (e) =>
          !(
            e.id === execution.id &&
            e.workspaceId === execution.workspaceId &&
            e.projectId === execution.projectId
          )
      )
      state.jobExecutions.push(deepClone(execution))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getExecutionById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<JobExecution | null> {
    const state = this.db.getActiveState()
    const e = (state.jobExecutions ?? []).find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return e ? deepClone(e) : null
  }

  async getExecutionsByJob(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<JobExecution[]> {
    const state = this.db.getActiveState()
    return (state.jobExecutions ?? [])
      .filter(
        (e) => e.jobId === jobId && e.workspaceId === workspaceId && e.projectId === projectId
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(deepClone)
  }

  async getExecutionsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<JobExecution[]> {
    const state = this.db.getActiveState()
    return (state.jobExecutions ?? [])
      .filter((e) => e.projectId === projectId && e.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(deepClone)
  }

  async getRecentExecutions(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string,
    limit: number
  ): Promise<JobExecution[]> {
    const all = await this.getExecutionsByJob(jobId, workspaceId, projectId)
    return all.slice(0, limit)
  }

  // --- JobMetrics ---

  async saveMetrics(metrics: JobMetrics): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.jobMetrics) state.jobMetrics = []
      state.jobMetrics = state.jobMetrics.filter(
        (m) =>
          !(
            m.id === metrics.id &&
            m.workspaceId === metrics.workspaceId &&
            m.projectId === metrics.projectId
          )
      )
      state.jobMetrics.push(deepClone(metrics))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getMetricsByJob(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<JobMetrics | null> {
    const state = this.db.getActiveState()
    const m = (state.jobMetrics ?? []).find(
      (x) => x.jobId === jobId && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return m ? deepClone(m) : null
  }

  async getMetricsByProject(projectId: string, workspaceId: WorkspaceId): Promise<JobMetrics[]> {
    const state = this.db.getActiveState()
    return (state.jobMetrics ?? [])
      .filter((m) => m.projectId === projectId && m.workspaceId === workspaceId)
      .map(deepClone)
  }
}
