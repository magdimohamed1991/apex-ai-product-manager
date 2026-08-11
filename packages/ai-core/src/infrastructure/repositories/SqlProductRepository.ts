import type { WorkspaceId } from '../../domain/value-objects'
import type {
  Workspace,
  Project,
  RepositoryConnection,
  PipelineRun,
  Finding,
  Recommendation,
  AIProductReasoning,
  PMDecisionTelemetry,
} from '../../domain/entities'
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

function mapPMDecisionTelemetryFromDb(t: unknown): PMDecisionTelemetry {
  const x = t as Record<string, unknown>
  return {
    ...x,
    recommendationPresentedAt: new Date(String(x.recommendationPresentedAt)),
    decisionStartedAt: new Date(String(x.decisionStartedAt)),
    decisionCompletedAt: new Date(String(x.decisionCompletedAt)),
    recordedAt: new Date(String(x.recordedAt)),
  } as unknown as PMDecisionTelemetry
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
    return (state.projects || []).filter((p) => p.workspaceId === workspaceId).map(mapProjectFromDb)
  }

  async saveProject(project: Project): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.projects) state.projects = []
      // Upsert must be scoped by (id, workspaceId). Filtering by `id` alone
      // would let a workspace B project with the same id (e.g. the shared
      // onboarding id "proj-core") DELETE workspace A's project row.
      state.projects = state.projects.filter(
        (p) => !(p.id === project.id && p.workspaceId === project.workspaceId)
      )
      state.projects.push(JSON.parse(JSON.stringify(project)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getRepositoryConnectionByIdAndWorkspace(
    id: string,
    workspaceId: WorkspaceId
  ): Promise<RepositoryConnection | null> {
    const state = this.db.getActiveState()
    const rc = state.repositoryConnections?.find(
      (x) => x.id === id && x.workspaceId === workspaceId
    )
    if (!rc) return null
    return mapRepoConnFromDb(rc)
  }

  async getRepositoryConnectionByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<RepositoryConnection | null> {
    const state = this.db.getActiveState()
    const rc = state.repositoryConnections?.find(
      (x) => x.projectId === projectId && x.workspaceId === workspaceId
    )
    if (!rc) return null
    return mapRepoConnFromDb(rc)
  }

  async saveRepositoryConnection(conn: RepositoryConnection): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.repositoryConnections) state.repositoryConnections = []
      state.repositoryConnections = state.repositoryConnections.filter(
        (rc) => !(rc.id === conn.id && rc.workspaceId === conn.workspaceId)
      )
      state.repositoryConnections.push(JSON.parse(JSON.stringify(conn)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getPipelineRunByIdAndWorkspace(
    id: string,
    workspaceId: WorkspaceId
  ): Promise<PipelineRun | null> {
    const state = this.db.getActiveState()
    const pr = state.pipelineRuns?.find((x) => x.id === id && x.workspaceId === workspaceId)
    if (!pr) return null
    return mapPipelineRunFromDb(pr)
  }

  async getPipelineRunsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<PipelineRun[]> {
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
      state.pipelineRuns = state.pipelineRuns.filter(
        (pr) => !(pr.id === run.id && pr.workspaceId === run.workspaceId)
      )
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
      // (id, workspaceId, projectId)-scoped upsert. A same-id finding in a
      // DIFFERENT project of the SAME workspace must NOT clobber this
      // project's row (Phase 3 isolation invariant). Finding ids are
      // currently random UUIDs so collisions are improbable in practice, but
      // the contract must hold regardless of upstream id generation — exactly
      // the same belt-and-braces guarantee applied to telemetry upserts.
      const findingList = state.findings as StoredFinding[]
      state.findings = findingList.filter(
        (f) =>
          !(
            f.id === finding.id &&
            f.workspaceId === finding.workspaceId &&
            f.projectId === projectId
          )
      )

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
        state.findings = list.filter(
          (f) => !(f.projectId === projectId && f.workspaceId === workspaceId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getRecommendationsByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<Recommendation[]> {
    const state = this.db.getActiveState()
    const list = (state.recommendations || []) as StoredRecommendation[]
    return list.filter((r) => r.projectId === projectId && r.workspaceId === workspaceId)
  }

  async getRecommendationByIdAndWorkspace(
    id: string,
    workspaceId: WorkspaceId
  ): Promise<Recommendation | null> {
    const state = this.db.getActiveState()
    const r = state.recommendations?.find((x) => x.id === id && x.workspaceId === workspaceId)
    if (!r) return null
    return JSON.parse(JSON.stringify(r)) as Recommendation
  }

  async getRecommendationByIdWorkspaceAndProject(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<Recommendation | null> {
    const state = this.db.getActiveState()
    const r = (state.recommendations as StoredRecommendation[] | undefined)?.find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return r ? (JSON.parse(JSON.stringify(r)) as Recommendation) : null
  }

  async saveRecommendation(rec: Recommendation, projectId: string): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.recommendations) state.recommendations = []
      // (id, workspaceId, projectId)-scoped upsert. A same-id recommendation
      // in a DIFFERENT project of the SAME workspace must NOT clobber this
      // project's row (Phase 3 isolation invariant — Scenario A/B). Today's
      // id generation makes insight-based rec ids project-unique and
      // finding-based rec ids random, so collisions are improbable; the
      // contract must hold regardless of upstream id generation, matching the
      // telemetry upsert's belt-and-braces guarantee.
      const recList = state.recommendations as StoredRecommendation[]
      state.recommendations = recList.filter(
        (r) => !(r.id === rec.id && r.workspaceId === rec.workspaceId && r.projectId === projectId)
      )

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
        state.recommendations = list.filter(
          (r) => !(r.projectId === projectId && r.workspaceId === workspaceId)
        )
      }
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async findProjectIdsForRecommendation(
    recommendationId: string,
    workspaceId: WorkspaceId
  ): Promise<string[]> {
    const state = this.db.getActiveState()
    const recs = (state.recommendations as StoredRecommendation[] | undefined) ?? []
    const matching = recs.filter((r) => r.id === recommendationId && r.workspaceId === workspaceId)
    return [...new Set(matching.map((r) => r.projectId))]
  }

  async getAIProductReasoningByWorkspaceAndProject(
    recommendationId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<AIProductReasoning | null> {
    const state = this.db.getActiveState()
    const found = state.aiReasonings?.find(
      (x) =>
        x.recommendationId === recommendationId &&
        x.workspaceId === workspaceId &&
        x.projectId === projectId
    )
    if (!found) return null
    return mapReasoningFromDb(found)
  }

  async savePMDecisionTelemetry(telemetry: PMDecisionTelemetry): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.pmDecisionTelemetry) state.pmDecisionTelemetry = []
      // Upsert scoped by (id, workspaceId, projectId). The id is a
      // deterministic hash of the (workspace, project, recommendation,
      // decisionStartedAt) tuple, so duplicate submissions of the SAME
      // decision window collapse idempotently. Scoping the delete by
      // projectId as well is a belt-and-braces guarantee that a different
      // project can never clobber this project's row even on an id
      // collision.
      state.pmDecisionTelemetry = state.pmDecisionTelemetry.filter(
        (t) =>
          !(
            t.id === telemetry.id &&
            t.workspaceId === telemetry.workspaceId &&
            t.projectId === telemetry.projectId
          )
      )
      state.pmDecisionTelemetry.push(JSON.parse(JSON.stringify(telemetry)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getPMDecisionTelemetryByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<PMDecisionTelemetry[]> {
    const state = this.db.getActiveState()
    return (state.pmDecisionTelemetry || [])
      .filter((t) => t.projectId === projectId && t.workspaceId === workspaceId)
      .map(mapPMDecisionTelemetryFromDb)
  }

  async saveAIProductReasoning(reasoning: AIProductReasoning): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.aiReasonings) state.aiReasonings = []
      state.aiReasonings = state.aiReasonings.filter(
        (x) =>
          !(
            x.recommendationId === reasoning.recommendationId &&
            x.workspaceId === reasoning.workspaceId &&
            x.projectId === reasoning.projectId
          )
      )
      state.aiReasonings.push(JSON.parse(JSON.stringify(reasoning)))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }
}
