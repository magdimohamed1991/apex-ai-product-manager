/**
 * ExecutiveIntelligenceService (H12) tests.
 *
 * Covers product-health snapshot derivation from real persisted data (with
 * an honest 'unknown' status when nothing is measured), report period
 * boundaries, markdown export contents, and JSON export validity — against
 * the real DurableFileDatabase.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlExecutiveRepository } from '../../../infrastructure/repositories/SqlExecutiveRepository'
import { SqlCompetitorRepository } from '../../../infrastructure/repositories/SqlCompetitorRepository'
import { SqlUXRepository } from '../../../infrastructure/repositories/SqlUXRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { SqlActionRepository } from '../../../infrastructure/repositories/SqlActionRepository'
import { SqlRecommendationOutcomeRepository } from '../../../infrastructure/repositories/SqlRecommendationOutcomeRepository'
import { ExecutiveIntelligenceService } from '../ExecutiveIntelligenceService'
import { createRecommendationOutcome } from '../../../domain/entities/RecommendationOutcome'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { WorkspaceId } from '../../../domain/value-objects'
import type { PMDecisionTelemetry } from '../../../domain/entities/PMDecisionTelemetry'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h12-executive-test')
const WS: WorkspaceId = createWorkspaceId('ws-a')
const PROJ = 'proj-a'

describe('ExecutiveIntelligenceService (H12)', () => {
  let database: DurableFileDatabase
  let productRepository: SqlProductRepository
  let actionRepository: SqlActionRepository
  let outcomeRepository: SqlRecommendationOutcomeRepository
  let executiveRepository: SqlExecutiveRepository
  let service: ExecutiveIntelligenceService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    productRepository = new SqlProductRepository(database)
    actionRepository = new SqlActionRepository(database)
    outcomeRepository = new SqlRecommendationOutcomeRepository(database)
    executiveRepository = new SqlExecutiveRepository(database)
    service = new ExecutiveIntelligenceService(
      executiveRepository,
      productRepository,
      actionRepository,
      outcomeRepository,
      new SqlCompetitorRepository(database),
      new SqlUXRepository(database),
      productRepository // the product repository IS the H7 telemetry store
    )
    await productRepository.saveProject({
      id: PROJ,
      workspaceId: WS,
      name: 'Project A',
      createdAt: new Date(),
    })
  })

  function telemetry(overrides: Partial<PMDecisionTelemetry> = {}): PMDecisionTelemetry {
    const startedAt = new Date('2026-08-09T10:00:00Z')
    return {
      id: `pmd-${crypto.randomUUID()}`,
      workspaceId: WS,
      projectId: PROJ,
      recommendationId: 'rec-1',
      category: 'TESTING',
      recommendationPresentedAt: new Date('2026-08-09T09:59:00Z'),
      decisionStartedAt: startedAt,
      decisionCompletedAt: new Date('2026-08-09T10:01:00Z'), // 60s window
      decision: 'ACCEPT',
      calibratedH6Score: 8,
      originalH3Score: 8,
      overrideOccurred: false,
      recordedAt: new Date(),
      ...overrides,
    }
  }

  it('generateDashboard with no data produces status unknown and null scores', async () => {
    const dashboard = await service.generateDashboard(WS, PROJ)
    const snapshot = dashboard.healthSnapshot!

    expect(snapshot.status).toBe('unknown')
    expect(snapshot.overallScore).toBeNull()
    expect(snapshot.pmAcceptanceRate).toBeNull()
    expect(snapshot.outcomeSuccessRate).toBeNull()
    expect(snapshot.decisionLatencySeconds).toBeNull()
    expect(snapshot.uxFrictionScore).toBeNull()
    expect(snapshot.openCriticalFindings).toBe(0)
    expect(dashboard.trends).toEqual([])
    expect(dashboard.roadmapInsights.length).toBeGreaterThan(0)
  })

  it('generateDashboard derives correct KPI values from real outcomes and telemetry', async () => {
    await outcomeRepository.save(
      createRecommendationOutcome({
        recommendationId: 'rec-1',
        workspaceId: WS,
        projectId: PROJ,
        status: 'VERIFIED_SUCCESS',
        verificationStatus: 'verified',
        outcomeSummary: 'Change confirmed in repository',
        actionId: null,
        executionId: null,
        verificationEvidence: [],
      })
    )
    await outcomeRepository.save(
      createRecommendationOutcome({
        recommendationId: 'rec-2',
        workspaceId: WS,
        projectId: PROJ,
        status: 'FAILED',
        verificationStatus: 'failed',
        outcomeSummary: 'Change not applied',
        actionId: null,
        executionId: null,
        verificationEvidence: [],
      })
    )
    await productRepository.savePMDecisionTelemetry(telemetry({ id: 'pmd-1', decision: 'ACCEPT' }))
    await productRepository.savePMDecisionTelemetry(
      telemetry({ id: 'pmd-2', recommendationId: 'rec-2', decision: 'REJECT' })
    )

    const dashboard = await service.generateDashboard(WS, PROJ)
    const snapshot = dashboard.healthSnapshot!

    expect(snapshot.outcomeSuccessRate).toBe(0.5) // 1 VERIFIED_SUCCESS / 2 outcomes
    expect(snapshot.pmAcceptanceRate).toBe(0.5) // 1 ACCEPT / 2 decisions
    expect(snapshot.decisionLatencySeconds).toBe(60) // both windows are 60s
    expect(snapshot.overallScore).not.toBeNull()

    const kpi = (name: string) => snapshot.kpis.find((k) => k.name === name)
    expect(kpi('outcome_success_rate')?.value).toBe(0.5)
    expect(kpi('pm_acceptance_rate')?.value).toBe(0.5)
    expect(kpi('decision_latency_seconds')?.value).toBe(60)
  })

  it('generateReport weekly boundary spans the last 7 days', async () => {
    const report = await service.generateReport(WS, PROJ, 'weekly')
    const days = (report.periodEnd.getTime() - report.periodStart.getTime()) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(6.9)
    expect(days).toBeLessThanOrEqual(7.1)
  })

  it('generateReport monthly boundary spans the last 30 days', async () => {
    const report = await service.generateReport(WS, PROJ, 'monthly')
    const days = (report.periodEnd.getTime() - report.periodStart.getTime()) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(29.9)
    expect(days).toBeLessThanOrEqual(30.1)
  })

  it('generateReport produces a non-empty markdownExport containing all section titles', async () => {
    const report = await service.generateReport(WS, PROJ, 'weekly')

    expect(report.markdownExport).not.toBeNull()
    expect(report.markdownExport!.length).toBeGreaterThan(100)
    const sections = report.sections.map((s) => s.title)
    for (const title of [
      'Executive Summary',
      'Product Health',
      'Competitor Intelligence',
      'UX Intelligence',
      'Recommendations',
      'Risk Forecasts',
      'Investment Opportunities',
      'Roadmap Insights',
    ]) {
      expect(sections).toContain(title)
      expect(report.markdownExport!).toContain(title)
    }
  })

  it('exportReport with format json returns a valid JSON string', async () => {
    const report = await service.generateReport(WS, PROJ, 'weekly')

    const result = await service.exportReport(WS, PROJ, report.id, 'json')
    expect(result.format).toBe('json')
    expect(result.content).not.toBeNull()

    const parsed = JSON.parse(result.content!) as Record<string, unknown>
    expect(parsed.period).toBe('weekly')
    expect(parsed.title).toBe(report.title)
    expect(parsed.markdownExport).toBeTruthy()
  })

  it('exportReport with format pdf is explicitly unavailable without a browser runtime', async () => {
    const report = await service.generateReport(WS, PROJ, 'weekly')
    const result = await service.exportReport(WS, PROJ, report.id, 'pdf')
    expect(result.format).toBe('pdf')
    expect(result.content).toBeNull()
    expect(result.note).toMatch(/browser runtime/)
  })
})
