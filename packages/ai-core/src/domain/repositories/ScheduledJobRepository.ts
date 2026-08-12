/**
 * ScheduledJobRepository — V2.1 domain contract.
 *
 * Defines the persistence contract for scheduled intelligence jobs,
 * their executions, and metrics. All queries are scoped by workspaceId.
 */
import type { WorkspaceId } from '../value-objects'
import type {
  ScheduledJob,
  JobExecution,
  JobMetrics,
  ScheduledJobStatus,
} from '../entities/ScheduledIntelligence'

export interface ScheduledJobRepository {
  // --- ScheduledJob ---

  saveJob(job: ScheduledJob): Promise<void>

  getJobById(id: string, workspaceId: WorkspaceId, projectId: string): Promise<ScheduledJob | null>

  getJobsByProject(projectId: string, workspaceId: WorkspaceId): Promise<ScheduledJob[]>

  getJobsByStatus(
    status: ScheduledJobStatus,
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<ScheduledJob[]>

  deleteJob(id: string, workspaceId: WorkspaceId, projectId: string): Promise<void>

  // --- JobExecution ---

  saveExecution(execution: JobExecution): Promise<void>

  getExecutionById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<JobExecution | null>

  getExecutionsByJob(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<JobExecution[]>

  getExecutionsByProject(projectId: string, workspaceId: WorkspaceId): Promise<JobExecution[]>

  getRecentExecutions(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string,
    limit: number
  ): Promise<JobExecution[]>

  // --- JobMetrics ---

  saveMetrics(metrics: JobMetrics): Promise<void>

  getMetricsByJob(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<JobMetrics | null>

  getMetricsByProject(projectId: string, workspaceId: WorkspaceId): Promise<JobMetrics[]>
}
