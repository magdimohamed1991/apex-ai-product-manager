import type { WorkspaceId } from '../value-objects'

export interface Project {
  id: string
  workspaceId: WorkspaceId
  name: string
  createdAt: Date
}

export interface RepositoryConnection {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  provider: 'github'
  owner: string
  repository: string
  defaultBranch: string
  status: 'connected' | 'error'
  createdAt: Date
  updatedAt: Date
}

export interface PipelineRun {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  repositoryConnectionId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  startedAt: Date
  completedAt: Date | null
  error: string | null
}
