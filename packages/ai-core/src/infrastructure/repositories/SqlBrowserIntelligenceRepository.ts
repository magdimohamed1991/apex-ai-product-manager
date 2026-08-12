/**
 * SqlBrowserIntelligenceRepository — H11 persistence adapter.
 *
 * Implements the BrowserIntelligenceRepository domain contract against the
 * DurableFileDatabase single-process store. All upserts are scoped by
 * (id, workspaceId, projectId) to preserve multi-tenant isolation.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { BrowserIntelligenceRepository } from '../../domain/repositories/BrowserIntelligenceRepository'
import type {
  CrawlJob,
  CrawledPage,
  BrowserIntelligenceSession,
} from '../../domain/entities/BrowserIntelligence'
import type { DurableFileDatabase } from '../database/DurableFileDatabase'

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export class SqlBrowserIntelligenceRepository implements BrowserIntelligenceRepository {
  constructor(private readonly db: DurableFileDatabase) {}

  // --- CrawlJob ---

  async saveCrawlJob(job: CrawlJob): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.crawlJobs) state.crawlJobs = []
      state.crawlJobs = state.crawlJobs.filter(
        (j) =>
          !(j.id === job.id && j.workspaceId === job.workspaceId && j.projectId === job.projectId)
      )
      state.crawlJobs.push(deepClone(job))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getCrawlJobById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CrawlJob | null> {
    const state = this.db.getActiveState()
    const j = (state.crawlJobs ?? []).find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return j ? deepClone(j) : null
  }

  async getCrawlJobsByProject(projectId: string, workspaceId: WorkspaceId): Promise<CrawlJob[]> {
    const state = this.db.getActiveState()
    return (state.crawlJobs ?? [])
      .filter((j) => j.projectId === projectId && j.workspaceId === workspaceId)
      .map(deepClone)
  }

  // --- CrawledPage ---

  async saveCrawledPage(page: CrawledPage): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.crawledPages) state.crawledPages = []
      state.crawledPages = state.crawledPages.filter(
        (p) =>
          !(
            p.id === page.id &&
            p.workspaceId === page.workspaceId &&
            p.projectId === page.projectId
          )
      )
      state.crawledPages.push(deepClone(page))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getCrawledPageById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CrawledPage | null> {
    const state = this.db.getActiveState()
    const p = (state.crawledPages ?? []).find(
      (x) => x.id === id && x.workspaceId === workspaceId && x.projectId === projectId
    )
    return p ? deepClone(p) : null
  }

  async getCrawledPagesByJob(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CrawledPage[]> {
    const state = this.db.getActiveState()
    return (state.crawledPages ?? [])
      .filter(
        (p) => p.jobId === jobId && p.workspaceId === workspaceId && p.projectId === projectId
      )
      .map(deepClone)
  }

  async getCrawledPagesByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<CrawledPage[]> {
    const state = this.db.getActiveState()
    return (state.crawledPages ?? [])
      .filter((p) => p.projectId === projectId && p.workspaceId === workspaceId)
      .map(deepClone)
  }

  async getLatestCrawledPageByUrl(
    url: string,
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<CrawledPage | null> {
    const state = this.db.getActiveState()
    const matches = (state.crawledPages ?? []).filter(
      (p) => p.url === url && p.projectId === projectId && p.workspaceId === workspaceId
    )
    if (matches.length === 0) return null
    const sorted = matches
      .slice()
      .sort((a, b) => new Date(b.crawledAt).getTime() - new Date(a.crawledAt).getTime())
    return deepClone(sorted[0])
  }

  // --- BrowserIntelligenceSession ---

  async saveBrowserSession(session: BrowserIntelligenceSession): Promise<void> {
    this.db.beginTransaction()
    try {
      const state = this.db.getActiveState()
      if (!state.browserSessions) state.browserSessions = []
      state.browserSessions = state.browserSessions.filter(
        (s) =>
          !(
            s.id === session.id &&
            s.workspaceId === session.workspaceId &&
            s.projectId === session.projectId
          )
      )
      state.browserSessions.push(deepClone(session))
      await this.db.commit()
    } catch (err) {
      this.db.rollback()
      throw err
    }
  }

  async getBrowserSessionByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<BrowserIntelligenceSession | null> {
    const state = this.db.getActiveState()
    const list = (state.browserSessions ?? []).filter(
      (s) => s.projectId === projectId && s.workspaceId === workspaceId
    )
    if (list.length === 0) return null
    const sorted = list
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return deepClone(sorted[0])
  }
}
