/**
 * CompetitorIntelligenceService (H9) tests.
 *
 * Covers competitor registration, full competitive analysis execution,
 * feature-matrix construction, gap detection, opportunity scoring, and
 * recommendation generation — against the real DurableFileDatabase so the
 * persistence path is exercised end-to-end.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { DurableFileDatabase } from '../../../infrastructure/database/DurableFileDatabase'
import { SqlCompetitorRepository } from '../../../infrastructure/repositories/SqlCompetitorRepository'
import { SqlProductRepository } from '../../../infrastructure/repositories/SqlProductRepository'
import { CompetitorIntelligenceService } from '../CompetitorIntelligenceService'
import { createWorkspaceId } from '../../../domain/value-objects'
import type { WorkspaceId } from '../../../domain/value-objects'
import type {
  Competitor,
  CompetitorGap,
  MarketOpportunity,
  CompetitorRecommendation,
  PositioningMatrix,
} from '../../../domain/entities/CompetitorIntelligence'
import { AuthorizationError } from '../../../errors/AppError'

const TEST_DB_DIR = path.join(process.cwd(), 'database-h9-competitor-test')
const WS: WorkspaceId = createWorkspaceId('ws-a')
const WS_OTHER: WorkspaceId = createWorkspaceId('ws-b')
const PROJ = 'proj-a'

describe('CompetitorIntelligenceService (H9)', () => {
  let database: DurableFileDatabase
  let productRepository: SqlProductRepository
  let competitorRepository: SqlCompetitorRepository
  let service: CompetitorIntelligenceService

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    database = new DurableFileDatabase(TEST_DB_DIR)
    await database.initialize()
    productRepository = new SqlProductRepository(database)
    competitorRepository = new SqlCompetitorRepository(database)
    service = new CompetitorIntelligenceService(competitorRepository, productRepository)
    await productRepository.saveProject({
      id: PROJ,
      workspaceId: WS,
      name: 'Project A',
      createdAt: new Date(),
    })
  })

  function competitorInput(
    overrides: Partial<Parameters<CompetitorIntelligenceService['addCompetitor']>[2]> = {}
  ) {
    return {
      name: 'Acme AI',
      slug: 'acme-ai',
      tier: 'direct' as const,
      websiteUrl: 'https://acme.example',
      ...overrides,
    }
  }

  function feature(name: string): Competitor['features'][number] {
    return {
      id: `feat-${name}`,
      name,
      category: 'core',
      description: `Feature ${name}`,
      maturity: 'ga',
      sourceUrl: null,
    }
  }

  it('addCompetitor persists and returns a valid competitor', async () => {
    const c = await service.addCompetitor(
      WS,
      PROJ,
      competitorInput({ features: [feature('Code Review')] })
    )

    expect(c.id).toBeTruthy()
    expect(c.name).toBe('Acme AI')
    expect(c.slug).toBe('acme-ai')
    expect(c.projectId).toBe(PROJ)
    expect(c.workspaceId).toBe(WS)

    const persisted = await competitorRepository.getCompetitorsByProject(PROJ, WS)
    expect(persisted).toHaveLength(1)
    expect(persisted[0].features[0].name).toBe('Code Review')
  })

  it('rejects adding competitors to a project the workspace does not own', async () => {
    await expect(service.addCompetitor(WS_OTHER, PROJ, competitorInput())).rejects.toThrow(
      AuthorizationError
    )
  })

  it('runCompetitorAnalysis with 0 competitors produces empty matrices and no recommendations', async () => {
    const analysis = await service.runCompetitorAnalysis(WS, PROJ)

    expect(analysis.status).toBe('completed')
    expect(analysis.error).toBeNull()
    expect(analysis.competitors).toHaveLength(0)
    expect(analysis.featureMatrix?.features).toEqual([])
    expect(analysis.opportunities).toEqual([])
    expect(analysis.recommendations).toEqual([])
    expect(await service.getMarketOpportunities(WS, PROJ)).toEqual([])
    expect(await service.getCompetitorRecommendations(WS, PROJ)).toEqual([])
  })

  it('runCompetitorAnalysis with 2 competitors builds a FeatureMatrix with correct cell values', async () => {
    await service.addCompetitor(
      WS,
      PROJ,
      competitorInput({
        name: 'Alpha',
        slug: 'alpha',
        websiteUrl: 'https://alpha.example',
        features: [feature('f1'), feature('f2')],
      })
    )
    await service.addCompetitor(
      WS,
      PROJ,
      competitorInput({
        name: 'Beta',
        slug: 'beta',
        websiteUrl: 'https://beta.example',
        features: [feature('f2'), feature('f3')],
      })
    )

    const analysis = await service.runCompetitorAnalysis(WS, PROJ)
    const matrix = analysis.featureMatrix
    expect(matrix).not.toBeNull()
    expect(matrix!.features).toEqual(['f1', 'f2', 'f3'])

    const [alpha, beta] = await service.getCompetitors(WS, PROJ)
    const cell = (competitorId: string, feature: string) =>
      matrix!.cells.find((c) => c.competitorId === competitorId && c.featureId === feature)?.value

    expect(cell(alpha.id, 'f1')).toBe('yes')
    expect(cell(alpha.id, 'f2')).toBe('yes')
    expect(cell(alpha.id, 'f3')).toBe('no')
    expect(cell(beta.id, 'f1')).toBe('no')
    expect(cell(beta.id, 'f2')).toBe('yes')
    expect(cell(beta.id, 'f3')).toBe('yes')
  })

  it('_detectGaps detects features present in both competitors but absent from the product', async () => {
    await service.addCompetitor(
      WS,
      PROJ,
      competitorInput({
        name: 'Alpha',
        slug: 'alpha',
        websiteUrl: 'https://alpha.example',
        features: [feature('shared'), feature('only-alpha')],
      })
    )
    await service.addCompetitor(
      WS,
      PROJ,
      competitorInput({
        name: 'Beta',
        slug: 'beta',
        websiteUrl: 'https://beta.example',
        features: [feature('shared')],
      })
    )

    const competitors = await service.getCompetitors(WS, PROJ)
    const svc = service as unknown as { _detectGaps: (comps: Competitor[]) => CompetitorGap[] }
    const gaps = svc._detectGaps(competitors)

    // "shared" is present in 2/2 competitors (>50%) → gap. "only-alpha" is
    // present in 1/2 (exactly 50%, not >50%) → no gap.
    expect(gaps.map((g) => g.featureName)).toEqual(['shared'])
    expect(gaps[0].competitorsWithFeature).toHaveLength(2)
  })

  it('_generateRecommendations emits close_gap for gaps with score >= 6', async () => {
    await service.addCompetitor(
      WS,
      PROJ,
      competitorInput({
        name: 'Alpha',
        slug: 'alpha',
        websiteUrl: 'https://alpha.example',
        features: [feature('shared')],
      })
    )
    await service.addCompetitor(
      WS,
      PROJ,
      competitorInput({
        name: 'Beta',
        slug: 'beta',
        websiteUrl: 'https://beta.example',
        features: [feature('shared')],
      })
    )

    const competitors = await service.getCompetitors(WS, PROJ)
    const svc = service as unknown as {
      _detectGaps: (comps: Competitor[]) => CompetitorGap[]
      _scoreOpportunities: (
        wsId: WorkspaceId,
        projectId: string,
        gaps: CompetitorGap[],
        total: number
      ) => MarketOpportunity[]
      _generateRecommendations: (
        wsId: WorkspaceId,
        projectId: string,
        opportunities: MarketOpportunity[],
        advantages: string[],
        matrix: PositioningMatrix
      ) => CompetitorRecommendation[]
    }

    const gaps = svc._detectGaps(competitors)
    const opportunities = svc._scoreOpportunities(WS, PROJ, gaps, competitors.length)
    // 2/2 competitors have the feature → opportunity score 10 ≥ 6.
    expect(opportunities[0].opportunityScore).toBe(10)

    const analysis = await service.runCompetitorAnalysis(WS, PROJ)
    const matrix = analysis.positioningMatrix!
    const recs = svc._generateRecommendations(WS, PROJ, opportunities, [], matrix)

    const closeGap = recs.find((r) => r.type === 'close_gap')
    expect(closeGap).toBeDefined()
    expect(closeGap!.title).toContain('shared')
    expect(closeGap!.priority).toBe('critical')
    expect(recs.every((r) => r.opportunityScore >= 6)).toBe(true)
  })
})
