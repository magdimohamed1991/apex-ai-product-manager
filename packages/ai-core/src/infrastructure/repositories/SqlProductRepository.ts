/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkspaceId } from '../../domain/value-objects'
import type { Workspace, Project, RepositoryConnection, PipelineRun, Finding, Recommendation, AIProductReasoning } from '../../domain/entities'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import { DurableFileDatabase } from '../database/DurableFileDatabase'

interface StoredFinding extends Finding {
  projectId: string
}

interface StoredRecommendation extends Recommendation {
  projectId: string
}

function mapWorkspaceFromDb(w: unknown): Workspace {
  const x = w as Record<string, unknown>
  return {
    ...x,
    createdAt: new Date(x.createdAt as string),
    updatedAt: new Date(x.updatedAt as string),
  } as unknown as Workspace
}

function mapProjectFromDb(p: unknown): Project {
  const x = p as Record<string, unknown>
  return {
    ...x,
    createdAt: new Date(x.createdAt as string),
  } as unknown as Project
}

function mapRepoConnFromDb(rc: unknown): RepositoryConnection {
  const x = rc as Record<string, unknown>
  return {
    ...x,
    createdAt: new Date(x.createdAt as string),
    updatedAt: new Date(x.updatedAt as string),
  } as unknown as RepositoryConnection
}

function mapPipelineRunFromDb(pr: unknown): PipelineRun {
  const x = pr as Record<string, unknown>
  return {
    ...x,
    startedAt: new Date(x.startedAt as string),
    completedAt: x.completedAt ? new Date(x.completedAt as string) : null,
  } as unknown as PipelineRun
}

function mapReasoningFromDb(r: unknown): AIProductReasoning {
  const x = r as Record<string, unknown>
  return {
    ...x,
    timestamp: new Date(x.timestamp as string),
  } as unknown as AIProductReasoning
}

export class SqlProductRepository implements ProductRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  async getWorkspaceById(id: WorkspaceId): Promise<Workspace | null> {
    const state = this.db.getActiveState()
    const w = state.workspaces?.find((x) => x.id === id)
    if (!w) return null
    return mapWorkspaceFromDb(w)
  }

  async getAllWorkspaces(): Promise<Workspace[]> {
    const state = this.db.getActiveState()
    return (state.workspaces || []).map(mapWorkspaceFromDb)
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.workspaces) state.workspaces = []
      state.workspaces = state.workspaces.filter((w) => w.id !== workspace.id)
      state.workspaces.push(JSON.parse(JSON.stringify(workspace)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getProjectByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<Project | null> {
    const state = this.db.getActiveState()
    const p = state.projects?.find((x) => x.id === id && x.workspaceId === workspaceId)
    if (!p) return null
    return mapProjectFromDb(p)
  }

  async getProjectsByWorkspace(workspaceId: WorkspaceId): Promise<Project[]> {
    const state = this.db.getActiveState()
    return (state.projects || [])
      .filter((p) => p.workspaceId === workspaceId)
      .map(mapProjectFromDb)
  }

  async saveProject(project: Project): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.projects) state.projects = []
      state.projects = state.projects.filter((p) => p.id !== project.id)
      state.projects.push(JSON.parse(JSON.stringify(project)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getRepositoryConnectionByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<RepositoryConnection | null> {
    const state = this.db.getActiveState()
    const rc = state.repositoryConnections?.find((x) => x.id === id && x.workspaceId === workspaceId)
    if (!rc) return null
    return mapRepoConnFromDb(rc)
  }

  async getRepositoryConnectionByProject(projectId: string, workspaceId: WorkspaceId): Promise<RepositoryConnection | null> {
    const state = this.db.getActiveState()
    const rc = state.repositoryConnections?.find((x) => x.projectId === projectId && x.workspaceId === workspaceId)
    if (!rc) return null
    return mapRepoConnFromDb(rc)
  }

  async saveRepositoryConnection(conn: RepositoryConnection): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.repositoryConnections) state.repositoryConnections = []
      state.repositoryConnections = state.repositoryConnections.filter((rc) => rc.id !== conn.id)
      state.repositoryConnections.push(JSON.parse(JSON.stringify(conn)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getPipelineRunByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<PipelineRun | null> {
    const state = this.db.getActiveState()
    const pr = state.pipelineRuns?.find((x) => x.id === id && x.workspaceId === workspaceId)
    if (!pr) return null
    return mapPipelineRunFromDb(pr)
  }

  async getPipelineRunsByProject(projectId: string, workspaceId: WorkspaceId): Promise<PipelineRun[]> {
    const state = this.db.getActiveState()
    return (state.pipelineRuns || [])
      .filter((pr) => pr.projectId === projectId && pr.workspaceId === workspaceId)
      .map(mapPipelineRunFromDb)
  }

  async savePipelineRun(run: PipelineRun): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.pipelineRuns) state.pipelineRuns = []
      state.pipelineRuns = state.pipelineRuns.filter((pr) => pr.id !== run.id)
      state.pipelineRuns.push(JSON.parse(JSON.stringify(run)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getFindingsByProject(projectId: string, workspaceId: WorkspaceId): Promise<Finding[]> {
    const state = this.db.getActiveState()
    const list = (state.findings || []) as StoredFinding[]
    return list.filter((f) => f.projectId === projectId && f.workspaceId === workspaceId)
  }

  async saveFinding(finding: Finding, projectId: string): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.findings) state.findings = []
      state.findings = state.findings.filter((f) => f.id !== finding.id)
      
      const stored: StoredFinding = {
        ...finding,
        projectId,
      }
      state.findings.push(JSON.parse(JSON.stringify(stored)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async deleteFindingsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.findings) {
        const list = state.findings as StoredFinding[]
        state.findings = list.filter((f) => !(f.projectId === projectId && f.workspaceId === workspaceId))
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getRecommendationsByProject(projectId: string, workspaceId: WorkspaceId): Promise<Recommendation[]> {
    const state = this.db.getActiveState()
    const list = (state.recommendations || []) as StoredRecommendation[]
    return list.filter((r) => r.projectId === projectId && r.workspaceId === workspaceId)
  }

  async getRecommendationByIdAndWorkspace(id: string, workspaceId: WorkspaceId): Promise<Recommendation | null> {
    const state = this.db.getActiveState()
    const r = state.recommendations?.find((x) => x.id === id && x.workspaceId === workspaceId)
    if (!r) return null
    return JSON.parse(JSON.stringify(r)) as Recommendation
  }

  async saveRecommendation(rec: Recommendation, projectId: string): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.recommendations) state.recommendations = []
      state.recommendations = state.recommendations.filter((r) => r.id !== rec.id)
      
      const stored: StoredRecommendation = {
        ...rec,
        projectId,
      }
      state.recommendations.push(JSON.parse(JSON.stringify(stored)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async deleteRecommendationsByProject(projectId: string, workspaceId: WorkspaceId): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (state.recommendations) {
        const list = state.recommendations as StoredRecommendation[]
        state.recommendations = list.filter((r) => !(r.projectId === projectId && r.workspaceId === workspaceId))
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getAIProductReasoning(recommendationId: string, workspaceId: WorkspaceId): Promise<AIProductReasoning | null> {
    const state = this.db.getActiveState()
    const found = state.aiReasonings?.find((x: any) => x.recommendationId === recommendationId && x.workspaceId === workspaceId)
    if (!found) return null
    return mapReasoningFromDb(found)
  }

  async saveAIProductReasoning(reasoning: AIProductReasoning): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.aiReasonings) state.aiReasonings = []
      state.aiReasonings = state.aiReasonings.filter(
        (x: any) => !(x.recommendationId === reasoning.recommendationId && x.workspaceId === reasoning.workspaceId)
      )
      state.aiReasonings.push(JSON.parse(JSON.stringify(reasoning)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
