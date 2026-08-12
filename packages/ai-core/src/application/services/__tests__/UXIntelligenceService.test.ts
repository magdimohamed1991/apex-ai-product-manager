/**
 * UXIntelligenceService (H10) tests.
 *
 * Covers journey/friction registration, ownership validation, UX analysis
 * execution with zero evidence, critical-friction recommendations, and
 * optimize_flow recommendations for low-completion journeys — against the
 * real DurableFileDatabase.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlUXRepository } from '../../../infrastructure/repositories/SqlUXRepository'
import { SqlBrowserIntelligenceRepository } from '../../../infrastructure/repositories/SqlBrowserIntelligenceRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { UXIntelligenceService } from '../UXIntelligenceService'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { WorkspaceId } from '../../../domain/value-objects'
import { AuthorizationError } from '../../../errors/AppError'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h10-ux-test')
const WS: WorkspaceId = createWorkspaceId('ws-a')
const WS_OTHER: WorkspaceId = createWorkspaceId('ws-b')
const PROJ = 'proj-a'

describe('UXIntelligenceService (H10)', () => {
  let database: DurableFileDatabase
  let productRepository: SqlProductRepository
  let uxRepository: SqlUXRepository
  let browserRepository: SqlBrowserIntelligenceRepository
  let service: UXIntelligenceService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    productRepository = new SqlProductRepository(database)
    uxRepository = new SqlUXRepository(database)
    browserRepository = new SqlBrowserIntelligenceRepository(database)
    service = new UXIntelligenceService(uxRepository, productRepository, browserRepository)
    await productRepository.saveProject({
      id: PROJ,
      workspaceId: WS,
      name: 'Project A',
      createdAt: new Date(),
    })
  })

  it('addUserJourney validates ownership and persists the journey', async () => {
    await expect(
      service.addUserJourney(WS_OTHER, PROJ, {
        name: 'Onboarding',
        description: 'First-run onboarding flow',
      })
    ).rejects.toThrow(AuthorizationError)

    const journey = await service.addUserJourney(WS, PROJ, {
      name: 'Onboarding',
      description: 'First-run onboarding flow',
      completionRate: 0.4,
    })

    expect(journey.id).toBeTruthy()
    expect(journey.name).toBe('Onboarding')
    expect(journey.completionRate).toBe(0.4)

    const persisted = await service.getJourneys(WS, PROJ)
    expect(persisted).toHaveLength(1)
  })

  it('addFrictionPoint validates ownership and persists', async () => {
    await expect(
      service.addFrictionPoint(WS_OTHER, PROJ, {
        title: 'Broken step',
        description: 'Step 3 never completes',
        severity: 'high',
        category: 'form_design',
      })
    ).rejects.toThrow(AuthorizationError)

    const fp = await service.addFrictionPoint(WS, PROJ, {
      title: 'Broken step',
      description: 'Step 3 never completes',
      severity: 'high',
      category: 'form_design',
      suggestedFix: 'Wire the submit handler',
    })

    expect(fp.id).toBeTruthy()
    expect(fp.severity).toBe('high')
    expect(fp.suggestedFix).toBe('Wire the submit handler')

    const persisted = await service.getFrictionPoints(WS, PROJ)
    expect(persisted).toHaveLength(1)
  })

  it('runUXAnalysis with 0 journeys/frictions produces null score and empty lists', async () => {
    const analysis = await service.runUXAnalysis(WS, PROJ)

    expect(analysis.status).toBe('completed')
    expect(analysis.error).toBeNull()
    expect(analysis.overallUXScore).toBeNull()
    expect(analysis.usabilityScore).toBeNull()
    expect(analysis.interactionAnalysis).not.toBeNull() // browser repo present, zero events
    expect(analysis.interactionAnalysis!.events).toEqual([])
    expect(analysis.journeys).toEqual([])
    expect(analysis.frictionPoints).toEqual([])
    expect(await service.getUXRecommendations(WS, PROJ)).toEqual([])
  })

  it('runUXAnalysis with a critical friction point generates a critical UX recommendation', async () => {
    await service.addFrictionPoint(WS, PROJ, {
      title: 'Checkout never submits',
      description: 'Clicking submit does nothing',
      severity: 'critical',
      category: 'form_design',
    })

    const analysis = await service.runUXAnalysis(WS, PROJ)
    const recs = await service.getUXRecommendations(WS, PROJ)

    expect(analysis.overallUXScore).not.toBeNull()
    expect(recs.length).toBeGreaterThan(0)
    const critical = recs.find((r) => r.priority === 'critical')
    expect(critical).toBeDefined()
    expect(critical!.title).toContain('Checkout never submits')
    expect(['reduce_friction', 'fix_interaction']).toContain(critical!.type)
    expect(critical!.relatedFrictionIds).toHaveLength(1)
    expect(recs).toHaveLength(recs.length)
  })

  it('journey with completionRate < 0.5 generates an optimize_flow recommendation', async () => {
    await service.addUserJourney(WS, PROJ, {
      name: 'Onboarding',
      description: 'First-run onboarding',
      completionRate: 0.3,
    })
    await service.addUserJourney(WS, PROJ, {
      name: 'Healthy flow',
      description: 'Works fine',
      completionRate: 0.8,
    })

    await service.runUXAnalysis(WS, PROJ)
    const recs = await service.getUXRecommendations(WS, PROJ)
    const optimize = recs.filter((r) => r.type === 'optimize_flow')

    expect(optimize).toHaveLength(1)
    expect(optimize[0].title).toContain('Onboarding')
    expect(optimize[0].priority).toBe('medium') // 0.3 >= 0.25 → medium
    expect(optimize[0].relatedJourneyIds).toHaveLength(1)
  })
})
