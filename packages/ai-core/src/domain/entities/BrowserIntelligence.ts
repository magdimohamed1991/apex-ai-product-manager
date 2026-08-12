/**
 * BrowserIntelligence domain entities (H11)
 *
 * Models web crawl jobs, crawled pages, and browser intelligence sessions.
 * Includes robots.txt compliance, rate limiting state, cache metadata,
 * snapshotting, and incremental update tracking.
 */
import type { WorkspaceId } from '../value-objects'

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type CrawlJobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'rate_limited' | 'robots_blocked'
export type CrawlPageType =
  | 'homepage'
  | 'pricing'
  | 'features'
  | 'documentation'
  | 'changelog'
  | 'blog'
  | 'about'
  | 'api_reference'
  | 'other'
export type ExtractedDataType =
  | 'pricing'
  | 'feature_list'
  | 'changelog_entry'
  | 'documentation'
  | 'navigation'
  | 'metadata'
  | 'text_content'

// ---------------------------------------------------------------------------
// Robots.txt compliance record
// ---------------------------------------------------------------------------

export interface RobotsPolicy {
  url: string
  allowed: boolean
  crawlDelaySeconds: number | null
  checkedAt: Date
}

// ---------------------------------------------------------------------------
// Crawl rate limiter state
// ---------------------------------------------------------------------------

export interface CrawlRateLimitState {
  domain: string
  requestsPerMinute: number
  lastRequestAt: Date | null
  backoffUntil: Date | null
  consecutiveErrors: number
}

// ---------------------------------------------------------------------------
// Extracted structured data
// ---------------------------------------------------------------------------

export interface ExtractedData {
  type: ExtractedDataType
  /** Raw extracted content — structured as-is from the page */
  content: Record<string, unknown>
  confidence: number // 0–1
  extractedAt: Date
}

// ---------------------------------------------------------------------------
// Crawled page
// ---------------------------------------------------------------------------

export interface CrawledPage {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  jobId: string
  url: string
  pageType: CrawlPageType
  title: string | null
  statusCode: number
  /** SHA-256 of the page body — used for incremental update detection */
  contentHash: string | null
  extractedData: ExtractedData[]
  /** HTML snapshot — stored for diff / history purposes */
  snapshotRef: string | null // path or identifier; never the full HTML in JSON
  robotsPolicy: RobotsPolicy | null
  crawledAt: Date
  /** Set when the hash differs from the previous crawl */
  changedAt: Date | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Crawl job
// ---------------------------------------------------------------------------

export interface CrawlJobTarget {
  url: string
  pageType: CrawlPageType
  followLinks: boolean
  maxDepth: number
}

export interface CrawlJob {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  /** What triggered this job: 'user', 'scheduled', 'competitor_analysis' */
  origin: 'user' | 'scheduled' | 'competitor_analysis' | 'ux_analysis'
  targets: CrawlJobTarget[]
  status: CrawlJobStatus
  pagesDiscovered: number
  pagesCrawled: number
  pagesSkipped: number
  pagesErrored: number
  rateLimitStates: CrawlRateLimitState[]
  respectRobots: boolean
  startedAt: Date
  completedAt: Date | null
  error: string | null
  /** Next run time for scheduled crawls; null for one-off jobs */
  nextScheduledAt: Date | null
}

// ---------------------------------------------------------------------------
// Browser intelligence session (top-level aggregate for a project)
// ---------------------------------------------------------------------------

export interface BrowserIntelligenceSession {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  /** URLs that were the primary targets for this session */
  seedUrls: string[]
  crawlJobIds: string[]
  /** Summary statistics across all jobs in this session */
  totalPagesCrawled: number
  totalDataPoints: number
  /** Timestamp of the most recent incremental update detected */
  lastIncrementalUpdateAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Validators & factories
// ---------------------------------------------------------------------------

export function validateCrawlJob(j: CrawlJob): void {
  if (!j.id || !j.id.trim()) throw new Error('CrawlJob must have a valid id')
  if (!j.workspaceId || !j.workspaceId.trim()) throw new Error('CrawlJob must have a workspaceId')
  if (!j.projectId || !j.projectId.trim()) throw new Error('CrawlJob must have a projectId')
  if (!Array.isArray(j.targets) || j.targets.length === 0)
    throw new Error('CrawlJob must have at least one target')
}

export function validateCrawledPage(p: CrawledPage): void {
  if (!p.id || !p.id.trim()) throw new Error('CrawledPage must have a valid id')
  if (!p.workspaceId || !p.workspaceId.trim())
    throw new Error('CrawledPage must have a workspaceId')
  if (!p.projectId || !p.projectId.trim()) throw new Error('CrawledPage must have a projectId')
  if (!p.url || !p.url.trim()) throw new Error('CrawledPage must have a url')
  if (!p.jobId || !p.jobId.trim()) throw new Error('CrawledPage must reference a jobId')
}

export function createCrawlJob(
  data: Omit<CrawlJob, 'id' | 'startedAt'> & { id?: string; startedAt?: Date }
): CrawlJob {
  const j: CrawlJob = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    origin: data.origin,
    targets: data.targets,
    status: data.status,
    pagesDiscovered: data.pagesDiscovered ?? 0,
    pagesCrawled: data.pagesCrawled ?? 0,
    pagesSkipped: data.pagesSkipped ?? 0,
    pagesErrored: data.pagesErrored ?? 0,
    rateLimitStates: data.rateLimitStates ?? [],
    respectRobots: data.respectRobots ?? true,
    startedAt: data.startedAt ?? new Date(),
    completedAt: data.completedAt ?? null,
    error: data.error ?? null,
    nextScheduledAt: data.nextScheduledAt ?? null,
  }
  validateCrawlJob(j)
  return j
}

export function createCrawledPage(
  data: Omit<CrawledPage, 'id' | 'crawledAt'> & { id?: string; crawledAt?: Date }
): CrawledPage {
  const p: CrawledPage = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    jobId: data.jobId,
    url: data.url,
    pageType: data.pageType,
    title: data.title ?? null,
    statusCode: data.statusCode,
    contentHash: data.contentHash ?? null,
    extractedData: data.extractedData ?? [],
    snapshotRef: data.snapshotRef ?? null,
    robotsPolicy: data.robotsPolicy ?? null,
    crawledAt: data.crawledAt ?? new Date(),
    changedAt: data.changedAt ?? null,
    error: data.error ?? null,
  }
  validateCrawledPage(p)
  return p
}

export function createBrowserIntelligenceSession(
  data: Omit<BrowserIntelligenceSession, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string
    createdAt?: Date
    updatedAt?: Date
  }
): BrowserIntelligenceSession {
  if (!data.workspaceId || !data.workspaceId.trim())
    throw new Error('BrowserIntelligenceSession must have a workspaceId')
  if (!data.projectId || !data.projectId.trim())
    throw new Error('BrowserIntelligenceSession must have a projectId')
  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    seedUrls: data.seedUrls ?? [],
    crawlJobIds: data.crawlJobIds ?? [],
    totalPagesCrawled: data.totalPagesCrawled ?? 0,
    totalDataPoints: data.totalDataPoints ?? 0,
    lastIncrementalUpdateAt: data.lastIncrementalUpdateAt ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  }
}
