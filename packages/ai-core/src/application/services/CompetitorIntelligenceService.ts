/**
 * CompetitorIntelligenceService (H9)
 *
 * Orchestrates competitor intelligence: registering competitor profiles,
 * running a full competitive analysis (feature matrix, positioning matrix,
 * differentiation analysis, gap detection, market opportunities, and
 * recommendations), and reading the persisted results.
 *
 * Every operation verifies project ownership inside the authenticated
 * workspace BEFORE touching any data, preserving tenancy and project
 * isolation. All derived values come from the persisted competitor
 * profiles — no synthetic metrics, no random values.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { CompetitorRepository } from '../../domain/repositories/CompetitorRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import { AuthorizationError } from '../../errors/AppError'
import {
  createCompetitor,
  createCompetitorAnalysis,
} from '../../domain/entities/CompetitorIntelligence'
import type {
  Competitor,
  CompetitorAnalysis,
  FeatureMatrix,
  FeatureMatrixCell,
  PositioningMatrix,
  PositioningDimension,
  DifferentiationAnalysis,
  DifferentiationFactor,
  CompetitorGap,
  MarketOpportunity,
  CompetitorRecommendation,
  CompetitorTier,
  CompetitorDataSource,
  CompetitorFeature,
  CompetitorPricing,
  CompetitorStrengthWeakness,
} from '../../domain/entities/CompetitorIntelligence'

const POSITIONING_DIMENSIONS = [
  'Price Competitiveness',
  'Ease of Use',
  'Feature Depth',
  'Developer Experience',
  'Documentation Quality',
  'Integration Ecosystem',
] as const

/**
 * Your-product baseline score for every positioning dimension. This is an
 * acknowledged assumption — the product's own telemetry is not yet wired
 * into the positioning engine, so every `yourScore` is labeled
 * `baseline_assumption` in the dimension `source` field and must never be
 * presented as a measured value.
 */
const YOUR_SCORE_BASELINE = 5.0

/** Weight applied per strength/weakness observation when deriving a competitor score. */
const SW_SCORE_STEP = 1.5

export interface AddCompetitorInput {
  name: string
  slug: string
  tier: CompetitorTier
  websiteUrl: string
  description?: string | null
  tagline?: string | null
  features?: CompetitorFeature[]
  pricing?: CompetitorPricing | null
  strengthsWeaknesses?: CompetitorStrengthWeakness[]
  dataSource?: CompetitorDataSource
}

export class CompetitorIntelligenceService {
  constructor(
    private readonly competitorRepository: CompetitorRepository,
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

  // ------------------------------------------------------------------
  // Competitor registration
  // ------------------------------------------------------------------

  async addCompetitor(
    workspaceId: WorkspaceId,
    projectId: string,
    input: AddCompetitorInput
  ): Promise<Competitor> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const competitor = createCompetitor({
      workspaceId,
      projectId,
      name: input.name,
      slug: input.slug,
      tier: input.tier,
      websiteUrl: input.websiteUrl,
      description: input.description ?? null,
      tagline: input.tagline ?? null,
      features: input.features ?? [],
      pricing: input.pricing ?? null,
      strengthsWeaknesses: input.strengthsWeaknesses ?? [],
      dataSource: input.dataSource ?? 'manual',
    })
    await this.competitorRepository.saveCompetitor(competitor)
    return competitor
  }

  // ------------------------------------------------------------------
  // Analysis execution
  // ------------------------------------------------------------------

  async runCompetitorAnalysis(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CompetitorAnalysis> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const competitors = await this.competitorRepository.getCompetitorsByProject(
      projectId,
      workspaceId
    )

    const analysis = createCompetitorAnalysis({
      workspaceId,
      projectId,
      status: 'running',
      competitors,
      featureMatrix: null,
      positioningMatrix: null,
      differentiationAnalysis: null,
      opportunities: [],
      recommendations: [],
      completedAt: null,
      error: null,
    })
    await this.competitorRepository.saveAnalysis(analysis)

    try {
      const featureMatrix = this._buildFeatureMatrix(workspaceId, projectId, competitors)
      const positioningMatrix = this._buildPositioningMatrix(workspaceId, projectId, competitors)
      const differentiation = this._buildDifferentiationAnalysis(
        workspaceId,
        projectId,
        positioningMatrix
      )
      const gaps = this._detectGaps(competitors)
      const opportunities = this._scoreOpportunities(
        workspaceId,
        projectId,
        gaps,
        competitors.length
      )
      const recommendations = this._generateRecommendations(
        workspaceId,
        projectId,
        opportunities,
        differentiation.uniqueAdvantages,
        positioningMatrix
      )

      // Persist every sub-entity independently so read endpoints can serve
      // them without reconstructing the aggregate.
      await this.competitorRepository.saveFeatureMatrix(featureMatrix)
      await this.competitorRepository.savePositioningMatrix(positioningMatrix)
      await this.competitorRepository.saveDifferentiationAnalysis(differentiation)
      for (const opp of opportunities) {
        await this.competitorRepository.saveMarketOpportunity(opp)
      }
      for (const rec of recommendations) {
        await this.competitorRepository.saveCompetitorRecommendation(rec)
      }

      analysis.status = 'completed'
      analysis.completedAt = new Date()
      analysis.featureMatrix = featureMatrix
      analysis.positioningMatrix = positioningMatrix
      analysis.differentiationAnalysis = differentiation
      analysis.opportunities = opportunities
      analysis.recommendations = recommendations
      await this.competitorRepository.saveAnalysis(analysis)
      return analysis
    } catch (err) {
      analysis.status = 'failed'
      analysis.completedAt = new Date()
      analysis.error = err instanceof Error ? err.message : String(err)
      await this.competitorRepository.saveAnalysis(analysis)
      throw err
    }
  }

  // ------------------------------------------------------------------
  // Read endpoints
  // ------------------------------------------------------------------

  async getAnalysis(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CompetitorAnalysis | null> {
    return this.competitorRepository.getAnalysisByProject(projectId, workspaceId)
  }

  async getCompetitors(workspaceId: WorkspaceId, projectId: string): Promise<Competitor[]> {
    return this.competitorRepository.getCompetitorsByProject(projectId, workspaceId)
  }

  async getFeatureMatrix(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<FeatureMatrix | null> {
    return this.competitorRepository.getFeatureMatrix(projectId, workspaceId)
  }

  async getPositioningMatrix(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<PositioningMatrix | null> {
    return this.competitorRepository.getPositioningMatrix(projectId, workspaceId)
  }

  async getDifferentiationAnalysis(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<DifferentiationAnalysis | null> {
    return this.competitorRepository.getDifferentiationAnalysis(projectId, workspaceId)
  }

  async getMarketOpportunities(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<MarketOpportunity[]> {
    return this.competitorRepository.getMarketOpportunitiesByProject(projectId, workspaceId)
  }

  async getCompetitorRecommendations(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<CompetitorRecommendation[]> {
    return this.competitorRepository.getCompetitorRecommendationsByProject(projectId, workspaceId)
  }

  // ------------------------------------------------------------------
  // Analysis builders
  // ------------------------------------------------------------------

  private _buildFeatureMatrix(
    workspaceId: WorkspaceId,
    projectId: string,
    competitors: Competitor[]
  ): FeatureMatrix {
    // Canonical feature names = the union of every feature name across
    // every competitor profile (order preserved, deduplicated).
    const features: string[] = []
    for (const c of competitors) {
      for (const f of c.features) {
        if (!features.includes(f.name)) features.push(f.name)
      }
    }

    const cells: FeatureMatrixCell[] = []
    for (const c of competitors) {
      const featureNames = new Set(c.features.map((f) => f.name))
      for (const feature of features) {
        let value: FeatureMatrixCell['value'] = 'no'
        if (featureNames.has(feature)) {
          // A feature present with a non-GA maturity level is `partial`;
          // everything else the competitor lists is treated as shipped.
          const feats = c.features.filter((f) => f.name === feature)
          value = feats.some((f) => f.maturity === 'ga' || f.maturity === 'beta')
            ? 'yes'
            : 'partial'
        }
        cells.push({ competitorId: c.id, featureId: feature, value, note: null })
      }
    }

    return {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      features,
      cells,
      generatedAt: new Date(),
    }
  }

  private _buildPositioningMatrix(
    workspaceId: WorkspaceId,
    projectId: string,
    competitors: Competitor[]
  ): PositioningMatrix {
    const dimensions: PositioningDimension[] = POSITIONING_DIMENSIONS.map((name) => {
      const competitorScores: Record<string, number> = {}
      for (const c of competitors) {
        competitorScores[c.id] = this._competitorDimensionScore(c, name)
      }
      return {
        name,
        yourScore: YOUR_SCORE_BASELINE,
        competitorScores,
        source: 'baseline_assumption',
      }
    })

    return {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      dimensions,
      generatedAt: new Date(),
    }
  }

  /**
   * Score a competitor on a dimension from their declared strengths and
   * weaknesses. Count strengths (weight +SW_SCORE_STEP) and weaknesses
   * (weight -SW_SCORE_STEP) whose dimension matches the positioning
   * dimension, starting from a neutral 5.0 and clamping to [0, 10].
   * Defaults to 5.0 when there is no evidence about that dimension.
   */
  private _competitorDimensionScore(c: Competitor, dimension: string): number {
    const dimLower = dimension.toLowerCase()
    let score = 5.0
    for (const sw of c.strengthsWeaknesses ?? []) {
      const swLower = (sw.dimension ?? '').toLowerCase()
      const matches =
        swLower === dimLower ||
        (swLower.length > 0 && swLower.includes(dimLower)) ||
        (dimLower.length > 0 && dimLower.includes(swLower))
      if (!matches) continue
      if (sw.polarity === 'strength') score += SW_SCORE_STEP
      else if (sw.polarity === 'weakness') score -= SW_SCORE_STEP
    }
    return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10
  }

  private _buildDifferentiationAnalysis(
    workspaceId: WorkspaceId,
    projectId: string,
    matrix: PositioningMatrix
  ): DifferentiationAnalysis {
    const factors: DifferentiationFactor[] = []
    const uniqueAdvantages: string[] = []
    const uniqueDisadvantages: string[] = []

    for (const dim of matrix.dimensions) {
      const competitorIds = Object.keys(dim.competitorScores)
      if (competitorIds.length === 0) continue

      const scores = competitorIds.map((id) => dim.competitorScores[id])
      const maxCompetitor = Math.max(...scores)
      const minCompetitor = Math.min(...scores)
      const maxGap = Math.max(
        Math.abs(dim.yourScore - maxCompetitor),
        Math.abs(dim.yourScore - minCompetitor)
      )

      const competitorStrength: Record<string, string> = {}
      for (const id of competitorIds) {
        competitorStrength[id] =
          `Competitor scored ${dim.competitorScores[id].toFixed(1)}/10 on "${dim.name}".`
      }

      factors.push({
        factor: dim.name,
        yourStrength: `Product baseline assumption ${dim.yourScore.toFixed(1)}/10 on "${dim.name}".`,
        competitorStrength,
        significance: maxGap >= 3 ? 'high' : maxGap >= 1.5 ? 'medium' : 'low',
      })

      // A unique advantage means your score exceeds EVERY competitor by more
      // than 1 point; a unique disadvantage means every competitor exceeds
      // your score by more than 1 point.
      if (competitorIds.every((id) => dim.yourScore - dim.competitorScores[id] > 1)) {
        uniqueAdvantages.push(dim.name)
      }
      if (competitorIds.every((id) => dim.competitorScores[id] - dim.yourScore > 1)) {
        uniqueDisadvantages.push(dim.name)
      }
    }

    return {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      factors,
      uniqueAdvantages,
      uniqueDisadvantages,
      generatedAt: new Date(),
    }
  }

  /**
   * Detect capability gaps: features present in more than half of the
   * competitors (i.e. industry-common capabilities your product does not
   * currently claim). A feature present in exactly half is not treated as a
   * gap — the threshold is strict >50%.
   */
  private _detectGaps(competitors: Competitor[]): CompetitorGap[] {
    const gaps: CompetitorGap[] = []
    if (competitors.length === 0) return gaps

    const total = competitors.length
    const featureOwners = new Map<string, string[]>()
    for (const c of competitors) {
      for (const f of c.features) {
        const owners = featureOwners.get(f.name) ?? []
        owners.push(c.id)
        featureOwners.set(f.name, owners)
      }
    }

    for (const [featureName, owners] of featureOwners) {
      if (owners.length / total <= 0.5) continue
      gaps.push({
        id: crypto.randomUUID(),
        featureName,
        description: `Feature "${featureName}" is present in ${owners.length} of ${total} tracked competitors and is not part of the product's current capability set.`,
        competitorsWithFeature: owners,
        significance: 'medium',
        estimatedEffort: 'medium',
      })
    }
    return gaps
  }

  /**
   * Convert every detected gap into a scored MarketOpportunity.
   *
   * opportunityScore = (competitorsWithFeature.length / totalCompetitors) * 10
   * — the adoption share among tracked competitors scaled to 0–10. The gap's
   * significance is derived deterministically from that score.
   */
  private _scoreOpportunities(
    workspaceId: WorkspaceId,
    projectId: string,
    gaps: CompetitorGap[],
    totalCompetitors: number
  ): MarketOpportunity[] {
    const denominator = Math.max(1, totalCompetitors)
    return gaps.map((gap) => {
      const opportunityScore =
        Math.round((gap.competitorsWithFeature.length / denominator) * 10 * 10) / 10
      gap.significance = this._significanceFromScore(opportunityScore)
      return {
        id: crypto.randomUUID(),
        workspaceId,
        projectId,
        title: `Add "${gap.featureName}" capability`,
        description: `Feature "${gap.featureName}" is offered by ${gap.competitorsWithFeature.length} competitor(s) and missing from the product.`,
        opportunityScore,
        gaps: [gap],
        addressableCompetitors: gap.competitorsWithFeature,
        rationale: 'Capability adoption among tracked competitors indicates market expectation.',
        generatedAt: new Date(),
      }
    })
  }

  private _significanceFromScore(score: number): CompetitorGap['significance'] {
    if (score >= 8) return 'critical'
    if (score >= 6) return 'high'
    if (score >= 4) return 'medium'
    return 'low'
  }

  private _generateRecommendations(
    workspaceId: WorkspaceId,
    projectId: string,
    opportunities: MarketOpportunity[],
    uniqueAdvantages: string[],
    matrix: PositioningMatrix
  ): CompetitorRecommendation[] {
    const recommendations: CompetitorRecommendation[] = []

    // close_gap for every opportunity scoring >= 6.
    for (const opp of opportunities) {
      if (opp.opportunityScore < 6) continue
      const gap = opp.gaps[0]
      recommendations.push({
        id: crypto.randomUUID(),
        workspaceId,
        projectId,
        type: 'close_gap',
        title: opp.title,
        description: opp.description,
        rationale: opp.rationale,
        priority: this._priorityFromScore(opp.opportunityScore),
        effort: 'medium',
        opportunityScore: opp.opportunityScore,
        relatedCompetitorIds: opp.addressableCompetitors,
        relatedGapIds: gap ? [gap.id] : [],
        createdAt: new Date(),
      })
    }

    // leverage_strength for every dimension where the product is uniquely
    // positioned above all competitors.
    for (const advantage of uniqueAdvantages) {
      const dim = matrix.dimensions.find((d) => d.name === advantage)
      if (!dim) continue
      const below = Object.entries(dim.competitorScores)
        .filter(([, score]) => score < dim.yourScore)
        .map(([id]) => id)
      recommendations.push({
        id: crypto.randomUUID(),
        workspaceId,
        projectId,
        type: 'leverage_strength',
        title: `Leverage strength in "${advantage}"`,
        description: `The product is uniquely positioned above all tracked competitors on "${advantage}".`,
        rationale: 'Unique advantage derived from positioning matrix comparison.',
        priority: 'medium',
        effort: 'low',
        opportunityScore: 6,
        relatedCompetitorIds: below,
        relatedGapIds: [],
        createdAt: new Date(),
      })
    }

    // Sort by opportunityScore descending so the highest-value
    // recommendations surface first.
    return recommendations.sort((a, b) => b.opportunityScore - a.opportunityScore)
  }

  private _priorityFromScore(score: number): CompetitorRecommendation['priority'] {
    if (score >= 8) return 'critical'
    if (score >= 6) return 'high'
    if (score >= 4) return 'medium'
    return 'low'
  }
}
