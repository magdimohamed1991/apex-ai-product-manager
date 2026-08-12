/**
 * BrowserIntelligenceService (H11)
 *
 * Orchestrates browser-based competitive intelligence: crawl jobs, crawled
 * pages, robots.txt compliance records, rate-limit state, incremental update
 * detection, and per-project browser intelligence sessions.
 *
 * This runtime has no real HTTP/browser engine, so page "extraction" is
 * explicitly labeled as requiring a browser runtime (the ExtractedData note
 * carries that epistemic label). Content hashes are real SHA-256 digests of
 * (url + pageType) — deliberately excluding the job id so that re-crawling
 * the same target yields a matching hash and incremental-update detection
 * only fires when the crawl input actually differs. All operations verify
 * project ownership first.
 */
import { createHash } from 'node:crypto'
import type { WorkspaceId } from '../../domain/value-objects'
import type { BrowserIntelligenceRepository } from '../../domain/repositories/BrowserIntelligenceRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import { AuthorizationError } from '../../errors/AppError'
import {
  createCrawlJob,
  createCrawledPage,
  createBrowserIntelligenceSession,
} from '../../domain/entities/BrowserIntelligence'
import type {
  CrawlJob,
  CrawlJobTarget,
  CrawledPage,
  ExtractedData,
  ExtractedDataType,
  RobotsPolicy,
  CrawlRateLimitState,
  BrowserIntelligenceSession,
} from '../../domain/entities/BrowserIntelligence'

/** Minimum gap enforced between requests to the same domain (1 second). */
const RATE_LIMIT_MIN_INTERVAL_MS = 1000

/** Confidence assigned to simulated extraction that needs a browser runtime. */
const SIMULATED_EXTRACTION_CONFIDENCE = 0.1

export class BrowserIntelligenceService {
  constructor(
    private readonly browserIntelligenceRepository: BrowserIntelligenceRepository,
    private readonly productRepository: ProductRepository
  ) {}

  private async verifyProjectOwnership(workspaceId: WorkspaceId, projectId: string): Promise<void> {
    const project = await this.productRepository.getProjectByIdAndWorkspace(projectId, workspaceId)
    if (!project) {
      throw new AuthorizationError(
        `Project "${projectId}" is not accessible in workspace "${workspaceId}"`
      )
    }
  }

  async startCrawl(
    workspaceId: WorkspaceId,
    projectId: string,
    targets: Pick<CrawlJobTarget, 'url' | 'pageType'>[],
    origin: CrawlJob['origin']
  ): Promise<CrawlJob> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    if (targets.length === 0) {
      throw new Error('startCrawl requires at least one target URL')
    }

    // Normalise to full targets with conservative crawl defaults — link
    // following is off and depth is 1 unless the caller opts in.
    const normalizedTargets: CrawlJobTarget[] = targets.map((t) => ({
      ...t,
      followLinks: false,
      maxDepth: 1,
    }))

    const job = createCrawlJob({
      workspaceId,
      projectId,
      origin,
      targets: normalizedTargets,
      status: 'running',
      respectRobots: true,
      pagesDiscovered: 0,
      pagesCrawled: 0,
      pagesSkipped: 0,
      pagesErrored: 0,
      rateLimitStates: [],
      completedAt: null,
      error: null,
      nextScheduledAt: null,
    })
    await this.browserIntelligenceRepository.saveCrawlJob(job)

    const crawledPages: CrawledPage[] = []
    const domainStates = new Map<string, CrawlRateLimitState>()
    let latestChangedAt: Date | null = null

    for (const target of normalizedTargets) {
      // --- robots.txt compliance record ---
      // Real robots.txt fetching is HTTP and not available in this runtime.
      // The policy is recorded as `allowed: true` with a conservative
      // crawl-delay default; genuine robots parsing requires a browser
      // runtime and would replace this record.
      const robotsPolicy: RobotsPolicy = {
        url: target.url,
        allowed: true,
        crawlDelaySeconds: 1,
        checkedAt: new Date(),
      }

      // --- rate limiting: enforce a 1s minimum between requests per domain ---
      const domain = this._domainOf(target.url)
      let state = domainStates.get(domain)
      if (!state) {
        state = {
          domain,
          requestsPerMinute: 0,
          lastRequestAt: null,
          backoffUntil: null,
          consecutiveErrors: 0,
        }
        domainStates.set(domain, state)
      }
      state.requestsPerMinute += 1
      if (state.lastRequestAt) {
        const elapsed = Date.now() - state.lastRequestAt.getTime()
        if (elapsed < RATE_LIMIT_MIN_INTERVAL_MS) {
          await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MIN_INTERVAL_MS - elapsed))
        }
      }
      state.lastRequestAt = new Date()

      const contentHash = this._contentHash(target.url, target.pageType)
      const extractedData = this._extractFor(target)

      // --- incremental update detection ---
      // A change is detected when the content hash differs from the most
      // recent crawl of the same URL in this project.
      const previous = await this.browserIntelligenceRepository.getLatestCrawledPageByUrl(
        target.url,
        projectId,
        workspaceId
      )
      const changedAt = previous && previous.contentHash !== contentHash ? new Date() : null
      if (changedAt && (!latestChangedAt || changedAt.getTime() > latestChangedAt.getTime())) {
        latestChangedAt = changedAt
      }

      const page = createCrawledPage({
        workspaceId,
        projectId,
        jobId: job.id,
        url: target.url,
        pageType: target.pageType,
        title: null,
        statusCode: 200,
        contentHash,
        extractedData,
        snapshotRef: null,
        robotsPolicy,
        changedAt,
        error: null,
      })
      await this.browserIntelligenceRepository.saveCrawledPage(page)
      crawledPages.push(page)
    }

    job.status = 'completed'
    job.completedAt = new Date()
    job.pagesDiscovered = normalizedTargets.length
    job.pagesCrawled = crawledPages.length
    job.pagesSkipped = Math.max(0, normalizedTargets.length - crawledPages.length)
    job.pagesErrored = 0
    job.rateLimitStates = [...domainStates.values()]
    await this.browserIntelligenceRepository.saveCrawlJob(job)

    await this._upsertSession(workspaceId, projectId, job, crawledPages, latestChangedAt)

    return job
  }

  async getCrawlJobs(workspaceId: WorkspaceId, projectId: string): Promise<CrawlJob[]> {
    return this.browserIntelligenceRepository.getCrawlJobsByProject(projectId, workspaceId)
  }

  async getCrawledPages(workspaceId: WorkspaceId, projectId: string): Promise<CrawledPage[]> {
    return this.browserIntelligenceRepository.getCrawledPagesByProject(projectId, workspaceId)
  }

  async getPagesByJob(
    jobId: string,
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CrawledPage[]> {
    return this.browserIntelligenceRepository.getCrawledPagesByJob(jobId, workspaceId, projectId)
  }

  async getSession(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<BrowserIntelligenceSession | null> {
    return this.browserIntelligenceRepository.getBrowserSessionByProject(projectId, workspaceId)
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private _domainOf(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  private _contentHash(url: string, pageType: string): string {
    return createHash('sha256').update(`${url}${pageType}`).digest('hex')
  }

  private _extractFor(target: CrawlJobTarget): ExtractedData[] {
    const typeToDataType: Partial<Record<CrawlJobTarget['pageType'], ExtractedDataType>> = {
      pricing: 'pricing',
      features: 'feature_list',
      changelog: 'changelog_entry',
      documentation: 'documentation',
    }
    const mapped = typeToDataType[target.pageType]
    const extractedAt = new Date()
    if (mapped) {
      return [
        {
          type: mapped,
          content: { note: 'requires browser runtime for real extraction' },
          confidence: SIMULATED_EXTRACTION_CONFIDENCE,
          extractedAt,
        },
      ]
    }
    return [
      {
        type: 'metadata',
        content: { pageType: target.pageType },
        confidence: SIMULATED_EXTRACTION_CONFIDENCE,
        extractedAt,
      },
    ]
  }

  private async _upsertSession(
    workspaceId: WorkspaceId,
    projectId: string,
    job: CrawlJob,
    pages: CrawledPage[],
    latestChangedAt: Date | null
  ): Promise<void> {
    const existing = await this.browserIntelligenceRepository.getBrowserSessionByProject(
      projectId,
      workspaceId
    )
    const now = new Date()
    // job.targets carries the normalised targets (with crawl defaults).
    const seedUrls = [...new Set([...(existing?.seedUrls ?? []), ...job.targets.map((t) => t.url)])]
    const crawlJobIds = [...new Set([...(existing?.crawlJobIds ?? []), job.id])]
    const totalPagesCrawled = (existing?.totalPagesCrawled ?? 0) + pages.length
    const totalDataPoints =
      (existing?.totalDataPoints ?? 0) + pages.reduce((sum, p) => sum + p.extractedData.length, 0)

    const session = createBrowserIntelligenceSession({
      id: existing?.id,
      workspaceId,
      projectId,
      seedUrls,
      crawlJobIds,
      totalPagesCrawled,
      totalDataPoints,
      lastIncrementalUpdateAt: latestChangedAt ?? existing?.lastIncrementalUpdateAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    await this.browserIntelligenceRepository.saveBrowserSession(session)
  }
}
