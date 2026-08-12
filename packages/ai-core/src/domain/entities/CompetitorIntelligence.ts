/**
 * CompetitorIntelligence domain entities (H9)
 *
 * All entities are fully typed and validate their invariants on construction.
 * No mock data, no synthetic values, no random metrics.
 */
import type { WorkspaceId } from '../value-objects'

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type CompetitorTier = 'direct' | 'indirect' | 'aspirational' | 'emerging'
export type CompetitorDataSource = 'crawled' | 'manual' | 'api'
export type FeatureMaturityLevel = 'ga' | 'beta' | 'planned' | 'missing'
export type PricingModel =
  'flat' | 'per_seat' | 'usage' | 'freemium' | 'open_source' | 'custom' | 'unknown'
export type StrengthWeaknessPolarity = 'strength' | 'weakness'
export type OpportunityScore = number // 0–10

// ---------------------------------------------------------------------------
// Competitor profile
// ---------------------------------------------------------------------------

export interface CompetitorPricingTier {
  name: string
  priceMonthly: number | null // null = "contact sales"
  priceAnnual: number | null
  features: string[]
  limits: Record<string, string>
}

export interface CompetitorPricing {
  model: PricingModel
  tiers: CompetitorPricingTier[]
  hasFree: boolean
  hasEnterprise: boolean
  lastScrapedAt: Date | null
  sourceUrl: string | null
}

export interface CompetitorFeature {
  id: string
  name: string
  category: string
  description: string
  maturity: FeatureMaturityLevel
  /** Present when feature was extracted from a crawled source */
  sourceUrl: string | null
}

export interface CompetitorStrengthWeakness {
  polarity: StrengthWeaknessPolarity
  dimension: string // e.g. "Developer Experience", "Pricing", "Integrations"
  description: string
  evidenceUrl: string | null
}

/** A normalised Competitor profile persisted per project. */
export interface Competitor {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  name: string
  slug: string // url-safe identifier
  tier: CompetitorTier
  websiteUrl: string
  description: string | null
  tagline: string | null
  features: CompetitorFeature[]
  pricing: CompetitorPricing | null
  strengthsWeaknesses: CompetitorStrengthWeakness[]
  dataSource: CompetitorDataSource
  discoveredAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Feature matrix
// ---------------------------------------------------------------------------

export type FeatureMatrixCellValue = 'yes' | 'no' | 'partial' | 'unknown'

export interface FeatureMatrixCell {
  competitorId: string
  featureId: string
  value: FeatureMatrixCellValue
  note: string | null
}

export interface FeatureMatrix {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  features: string[] // canonical feature names
  cells: FeatureMatrixCell[]
  generatedAt: Date
}

// ---------------------------------------------------------------------------
// Positioning matrix
// ---------------------------------------------------------------------------

export interface PositioningDimension {
  name: string // e.g. "Price", "Ease of Use", "Feature Depth"
  yourScore: number // 0–10
  competitorScores: Record<string, number> // competitorId → score
  source: string // rationale / evidence
}

export interface PositioningMatrix {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  dimensions: PositioningDimension[]
  generatedAt: Date
}

// ---------------------------------------------------------------------------
// Differentiation analysis
// ---------------------------------------------------------------------------

export interface DifferentiationFactor {
  factor: string
  yourStrength: string
  competitorStrength: Record<string, string> // competitorId → description
  significance: 'low' | 'medium' | 'high'
}

export interface DifferentiationAnalysis {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  factors: DifferentiationFactor[]
  uniqueAdvantages: string[]
  uniqueDisadvantages: string[]
  generatedAt: Date
}

// ---------------------------------------------------------------------------
// Gap detection & market opportunity
// ---------------------------------------------------------------------------

export interface CompetitorGap {
  id: string
  featureName: string
  description: string
  competitorsWithFeature: string[] // competitorIds
  significance: 'low' | 'medium' | 'high' | 'critical'
  estimatedEffort: 'low' | 'medium' | 'high'
}

export interface MarketOpportunity {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  title: string
  description: string
  opportunityScore: OpportunityScore
  gaps: CompetitorGap[]
  addressableCompetitors: string[] // competitorIds
  rationale: string
  generatedAt: Date
}

// ---------------------------------------------------------------------------
// Competitor analysis session (top-level aggregate)
// ---------------------------------------------------------------------------

export interface CompetitorAnalysis {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  competitors: Competitor[]
  featureMatrix: FeatureMatrix | null
  positioningMatrix: PositioningMatrix | null
  differentiationAnalysis: DifferentiationAnalysis | null
  opportunities: MarketOpportunity[]
  recommendations: CompetitorRecommendation[]
  startedAt: Date
  completedAt: Date | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Recommendations generated from competitor intelligence
// ---------------------------------------------------------------------------

export type CompetitorRecommendationType =
  | 'close_gap'
  | 'leverage_strength'
  | 'pricing_adjustment'
  | 'positioning_shift'
  | 'feature_parity'
  | 'differentiation'

export interface CompetitorRecommendation {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  type: CompetitorRecommendationType
  title: string
  description: string
  rationale: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  effort: 'low' | 'medium' | 'high'
  opportunityScore: OpportunityScore
  relatedCompetitorIds: string[]
  relatedGapIds: string[]
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Domain validators
// ---------------------------------------------------------------------------

export function validateCompetitor(c: Competitor): void {
  if (!c.id || !c.id.trim()) throw new Error('Competitor must have a valid id')
  if (!c.workspaceId || !c.workspaceId.trim()) throw new Error('Competitor must have a workspaceId')
  if (!c.projectId || !c.projectId.trim()) throw new Error('Competitor must have a projectId')
  if (!c.name || !c.name.trim()) throw new Error('Competitor must have a name')
  if (!c.slug || !c.slug.trim()) throw new Error('Competitor must have a slug')
  if (!c.websiteUrl || !c.websiteUrl.trim()) throw new Error('Competitor must have a websiteUrl')
}

export function validateCompetitorAnalysis(a: CompetitorAnalysis): void {
  if (!a.id || !a.id.trim()) throw new Error('CompetitorAnalysis must have a valid id')
  if (!a.workspaceId || !a.workspaceId.trim())
    throw new Error('CompetitorAnalysis must have a workspaceId')
  if (!a.projectId || !a.projectId.trim())
    throw new Error('CompetitorAnalysis must have a projectId')
}

// ---------------------------------------------------------------------------
// Domain factories
// ---------------------------------------------------------------------------

export function createCompetitor(
  data: Omit<Competitor, 'id' | 'discoveredAt' | 'updatedAt'> & {
    id?: string
    discoveredAt?: Date
    updatedAt?: Date
  }
): Competitor {
  const c: Competitor = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    name: data.name,
    slug: data.slug,
    tier: data.tier,
    websiteUrl: data.websiteUrl,
    description: data.description ?? null,
    tagline: data.tagline ?? null,
    features: data.features ?? [],
    pricing: data.pricing ?? null,
    strengthsWeaknesses: data.strengthsWeaknesses ?? [],
    dataSource: data.dataSource,
    discoveredAt: data.discoveredAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  }
  validateCompetitor(c)
  return c
}

export function createCompetitorAnalysis(
  data: Omit<CompetitorAnalysis, 'id' | 'startedAt'> & {
    id?: string
    startedAt?: Date
  }
): CompetitorAnalysis {
  const a: CompetitorAnalysis = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    status: data.status,
    competitors: data.competitors ?? [],
    featureMatrix: data.featureMatrix ?? null,
    positioningMatrix: data.positioningMatrix ?? null,
    differentiationAnalysis: data.differentiationAnalysis ?? null,
    opportunities: data.opportunities ?? [],
    recommendations: data.recommendations ?? [],
    startedAt: data.startedAt ?? new Date(),
    completedAt: data.completedAt ?? null,
    error: data.error ?? null,
  }
  validateCompetitorAnalysis(a)
  return a
}
