/**
 * BrowserIntelligenceRepository — domain repository contract for H11.
 */
import type { WorkspaceId } from '../value-objects'
import type {
  CrawlJob,
  CrawledPage,
  BrowserIntelligenceSession,
} from '../entities/BrowserIntelligence'

export interface BrowserIntelligenceRepository {
  saveCrawlJob(job: CrawlJob): Promise<void>
  getCrawlJobById(id: string, workspaceId: WorkspaceId, projectId: string): Promise<CrawlJob | null>
  getCrawlJobsByProject(projectId: string, workspaceId: WorkspaceId): Promise<CrawlJob[]>

  saveCrawledPage(page: CrawledPage): Promise<void>
  getCrawledPageById(
    id: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CrawledPage | null>
  getCrawledPagesByJob(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CrawledPage[]>
  getCrawledPagesByProject(projectId: string, workspaceId: WorkspaceId): Promise<CrawledPage[]>
  /** Returns the most recently crawled page for the given URL in this project. */
  getLatestCrawledPageByUrl(
    url: string,
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<CrawledPage | null>

  saveBrowserSession(session: BrowserIntelligenceSession): Promise<void>
  getBrowserSessionByProject(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<BrowserIntelligenceSession | null>
}
