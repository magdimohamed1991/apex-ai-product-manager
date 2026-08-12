/**
 * BrowserIntelligenceService (H11) tests.
 *
 * Covers crawl execution with typed extraction, deterministic content-hash
 * incremental-update detection, per-domain rate-limit state, and robots.txt
 * compliance recording — against the real DurableFileDatabase.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlBrowserIntelligenceRepository } from '../../../infrastructure/repositories/SqlBrowserIntelligenceRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { BrowserIntelligenceService } from '../BrowserIntelligenceService'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { WorkspaceId } from '../../../domain/value-objects'
import { AuthorizationError } from '../../../errors/AppError'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h11-browser-test')
const WS: WorkspaceId = createWorkspaceId('ws-a')
const WS_OTHER: WorkspaceId = createWorkspaceId('ws-b')
const PROJ = 'proj-a'
const PRICING_URL = 'https://acme.example/pricing'

describe('BrowserIntelligenceService (H11)', () => {
  let database: DurableFileDatabase
  let productRepository: SqlProductRepository
  let browserRepository: SqlBrowserIntelligenceRepository
  let service: BrowserIntelligenceService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    productRepository = new SqlProductRepository(database)
    browserRepository = new SqlBrowserIntelligenceRepository(database)
    service = new BrowserIntelligenceService(browserRepository, productRepository)
    await productRepository.saveProject({
      id: PROJ,
      workspaceId: WS,
      name: 'Project A',
      createdAt: new Date(),
    })
  })

  it('rejects crawling a project the workspace does not own', async () => {
    await expect(
      service.startCrawl(WS_OTHER, PROJ, [{ url: PRICING_URL, pageType: 'pricing' }], 'user')
    ).rejects.toThrow(AuthorizationError)
  })

  it('startCrawl with a pricing target creates a CrawledPage with typed ExtractedData', async () => {
    const job = await service.startCrawl(
      WS,
      PROJ,
      [{ url: PRICING_URL, pageType: 'pricing' }],
      'user'
    )

    expect(job.status).toBe('completed')
    expect(job.pagesDiscovered).toBe(1)
    expect(job.pagesCrawled).toBe(1)
    expect(job.pagesErrored).toBe(0)
    expect(job.respectRobots).toBe(true)

    const pages = await service.getCrawledPages(WS, PROJ)
    expect(pages).toHaveLength(1)
    const page = pages[0]!
    expect(page.pageType).toBe('pricing')
    expect(page.url).toBe(PRICING_URL)
    expect(page.statusCode).toBe(200)
    expect(page.extractedData[0].type).toBe('pricing')
    expect(page.extractedData[0].content.note).toBe('requires browser runtime for real extraction')
    expect(page.robotsPolicy!.allowed).toBe(true)
    expect(page.robotsPolicy!.crawlDelaySeconds).toBe(1)
  })

  it('detects content-hash match (no changedAt) vs mismatch (changedAt set)', async () => {
    // First crawl: no previous page for the URL → no change recorded.
    await service.startCrawl(WS, PROJ, [{ url: PRICING_URL, pageType: 'pricing' }], 'user')
    const first = await browserRepository.getLatestCrawledPageByUrl(PRICING_URL, PROJ, WS)
    expect(first).not.toBeNull()
    expect(first!.changedAt).toBeNull()

    // Identical re-crawl: the content hash matches → still no change.
    await service.startCrawl(WS, PROJ, [{ url: PRICING_URL, pageType: 'pricing' }], 'user')
    const second = await browserRepository.getLatestCrawledPageByUrl(PRICING_URL, PROJ, WS)
    expect(second).not.toBeNull()
    expect(second!.contentHash).toBe(first!.contentHash)
    expect(second!.changedAt).toBeNull()

    // Same URL, different page type: hash differs → change recorded.
    await service.startCrawl(WS, PROJ, [{ url: PRICING_URL, pageType: 'features' }], 'user')
    const third = await browserRepository.getLatestCrawledPageByUrl(PRICING_URL, PROJ, WS)
    expect(third).not.toBeNull()
    expect(third!.contentHash).not.toBe(first!.contentHash)
    expect(third!.changedAt).not.toBeNull()
  })

  it('records one rate-limit state entry per crawled domain', async () => {
    const job = await service.startCrawl(
      WS,
      PROJ,
      [
        { url: 'https://alpha.example/pricing', pageType: 'pricing' },
        { url: 'https://beta.example/pricing', pageType: 'pricing' },
      ],
      'user'
    )

    expect(job.rateLimitStates).toHaveLength(2)
    expect(job.rateLimitStates.map((s) => s.domain).sort()).toEqual([
      'alpha.example',
      'beta.example',
    ])
    expect(job.rateLimitStates.every((s) => s.requestsPerMinute >= 1)).toBe(true)
  })

  it('respectRobots=true is recorded on the job and its pages', async () => {
    const job = await service.startCrawl(
      WS,
      PROJ,
      [{ url: PRICING_URL, pageType: 'pricing' }],
      'scheduled'
    )

    expect(job.respectRobots).toBe(true)
    expect(job.origin).toBe('scheduled')

    const pages = await service.getCrawledPages(WS, PROJ)
    expect(pages[0]!.robotsPolicy).toMatchObject({
      url: PRICING_URL,
      allowed: true,
      crawlDelaySeconds: 1,
    })
  })

  it('upserts a session that aggregates crawl statistics across jobs', async () => {
    await service.startCrawl(WS, PROJ, [{ url: PRICING_URL, pageType: 'pricing' }], 'user')
    await service.startCrawl(
      WS,
      PROJ,
      [{ url: 'https://acme.example/features', pageType: 'features' }],
      'user'
    )

    const session = await service.getSession(WS, PROJ)
    expect(session).not.toBeNull()
    expect(session!.totalPagesCrawled).toBe(2)
    expect(session!.crawlJobIds).toHaveLength(2)
    expect(session!.seedUrls).toContain(PRICING_URL)
    expect(session!.totalDataPoints).toBe(2)
  })
})
