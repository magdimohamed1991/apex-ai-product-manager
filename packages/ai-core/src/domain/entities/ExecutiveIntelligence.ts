/**
 * ExecutiveIntelligence domain entities (H12)
 *
 * Models executive dashboards, strategic reports, product health snapshots,
 * trend detection, and market evolution signals.
 * No synthetic metrics — every value derives from persisted observations.
 */
import type { WorkspaceId } from '../value-objects'

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type ReportPeriod = 'weekly' | 'monthly' | 'quarterly'
export type ReportFormat = 'pdf' | 'markdown' | 'json'
export type TrendDirection = 'improving' | 'degrading' | 'stable' | 'volatile'
export type ProductHealthStatus = 'healthy' | 'at_risk' | 'critical' | 'unknown'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// ---------------------------------------------------------------------------
// KPI — a single measured indicator with full epistemic provenance
// ---------------------------------------------------------------------------

export interface ExecutiveKPI {
  name: string
  value: number | null
  unit: string // e.g. "%", "count", "score", "days"
  trend: TrendDirection
  previousValue: number | null
  periodLabel: string // e.g. "Last 30 days"
  source: string // which subsystem produced this value
  epistemicNote: string // explains confidence / data availability
}

// ---------------------------------------------------------------------------
// Product health snapshot
// ---------------------------------------------------------------------------

export interface ProductHealthSnapshot {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  status: ProductHealthStatus
  overallScore: number | null // 0–100; null = insufficient data
  kpis: ExecutiveKPI[]
  openCriticalFindings: number
  openHighFindings: number
  pendingRecommendations: number
  acceptedRecommendations: number
  outcomeSuccessRate: number | null // 0–1
  decisionLatencySeconds: number | null
  pmAcceptanceRate: number | null // 0–1
  competitorGapsCount: number
  uxFrictionScore: number | null // 0–10
  snapshotAt: Date
}

// ---------------------------------------------------------------------------
// Trend detection
// ---------------------------------------------------------------------------

export interface TrendDataPoint {
  label: string // e.g. ISO date or sprint name
  value: number
}

export interface TrendDetection {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  metricName: string
  direction: TrendDirection
  magnitude: number // absolute change over the period
  percentageChange: number | null
  dataPoints: TrendDataPoint[]
  periodStart: Date
  periodEnd: Date
  significance: 'low' | 'medium' | 'high'
  interpretation: string // plain-English explanation
  detectedAt: Date
}

// ---------------------------------------------------------------------------
// Market evolution signal
// ---------------------------------------------------------------------------

export interface MarketEvolutionSignal {
  id: string
  signalType: 'competitor_feature_added' | 'pricing_change' | 'new_entrant' | 'category_shift'
  title: string
  description: string
  sourceCompetitorId: string | null
  detectedAt: Date
  significance: 'low' | 'medium' | 'high'
}

// ---------------------------------------------------------------------------
// Investment opportunity
// ---------------------------------------------------------------------------

export interface InvestmentOpportunity {
  id: string
  title: string
  description: string
  estimatedROI: string // qualitative, e.g. "2–3× in 6 months"
  confidence: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  rationale: string
  evidenceSources: string[] // IDs of H9/H10/H11 entities that support this
  priority: 'low' | 'medium' | 'high' | 'critical'
}

// ---------------------------------------------------------------------------
// Risk forecast
// ---------------------------------------------------------------------------

export interface RiskForecast {
  id: string
  title: string
  description: string
  level: RiskLevel
  probability: 'low' | 'medium' | 'high'
  timeHorizon: 'immediate' | 'near_term' | 'long_term'
  mitigations: string[]
  evidenceSources: string[]
}

// ---------------------------------------------------------------------------
// Executive dashboard (live view, not a report)
// ---------------------------------------------------------------------------

export interface ExecutiveDashboard {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  healthSnapshot: ProductHealthSnapshot | null
  trends: TrendDetection[]
  marketSignals: MarketEvolutionSignal[]
  investmentOpportunities: InvestmentOpportunity[]
  riskForecasts: RiskForecast[]
  roadmapInsights: string[] // plain-text strategic insights for the roadmap
  generatedAt: Date
}

// ---------------------------------------------------------------------------
// Executive report (exportable artefact)
// ---------------------------------------------------------------------------

export interface ReportSection {
  title: string
  content: string // markdown body
  order: number
}

export interface ExecutiveReport {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  period: ReportPeriod
  periodStart: Date
  periodEnd: Date
  title: string
  executiveSummary: string
  sections: ReportSection[]
  kpis: ExecutiveKPI[]
  trends: TrendDetection[]
  investmentOpportunities: InvestmentOpportunity[]
  riskForecasts: RiskForecast[]
  /** Serialised export payload; null until export is requested */
  markdownExport: string | null
  jsonExport: string | null // JSON.stringify of the report
  generatedAt: Date
  exportedAt: Date | null
}

// ---------------------------------------------------------------------------
// Validators & factories
// ---------------------------------------------------------------------------

export function validateProductHealthSnapshot(s: ProductHealthSnapshot): void {
  if (!s.id || !s.id.trim()) throw new Error('ProductHealthSnapshot must have a valid id')
  if (!s.workspaceId || !s.workspaceId.trim())
    throw new Error('ProductHealthSnapshot must have a workspaceId')
  if (!s.projectId || !s.projectId.trim())
    throw new Error('ProductHealthSnapshot must have a projectId')
  if (s.overallScore !== null && (s.overallScore < 0 || s.overallScore > 100)) {
    throw new Error('ProductHealthSnapshot overallScore must be in [0,100]')
  }
}

export function validateExecutiveReport(r: ExecutiveReport): void {
  if (!r.id || !r.id.trim()) throw new Error('ExecutiveReport must have a valid id')
  if (!r.workspaceId || !r.workspaceId.trim())
    throw new Error('ExecutiveReport must have a workspaceId')
  if (!r.projectId || !r.projectId.trim()) throw new Error('ExecutiveReport must have a projectId')
  if (!r.title || !r.title.trim()) throw new Error('ExecutiveReport must have a title')
  if (r.periodStart >= r.periodEnd)
    throw new Error('ExecutiveReport periodStart must precede periodEnd')
}

export function createProductHealthSnapshot(
  data: Omit<ProductHealthSnapshot, 'id' | 'snapshotAt'> & { id?: string; snapshotAt?: Date }
): ProductHealthSnapshot {
  const s: ProductHealthSnapshot = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    status: data.status,
    overallScore: data.overallScore ?? null,
    kpis: data.kpis ?? [],
    openCriticalFindings: data.openCriticalFindings ?? 0,
    openHighFindings: data.openHighFindings ?? 0,
    pendingRecommendations: data.pendingRecommendations ?? 0,
    acceptedRecommendations: data.acceptedRecommendations ?? 0,
    outcomeSuccessRate: data.outcomeSuccessRate ?? null,
    decisionLatencySeconds: data.decisionLatencySeconds ?? null,
    pmAcceptanceRate: data.pmAcceptanceRate ?? null,
    competitorGapsCount: data.competitorGapsCount ?? 0,
    uxFrictionScore: data.uxFrictionScore ?? null,
    snapshotAt: data.snapshotAt ?? new Date(),
  }
  validateProductHealthSnapshot(s)
  return s
}

export function createExecutiveReport(
  data: Omit<ExecutiveReport, 'id' | 'generatedAt'> & { id?: string; generatedAt?: Date }
): ExecutiveReport {
  const r: ExecutiveReport = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    period: data.period,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    title: data.title,
    executiveSummary: data.executiveSummary,
    sections: data.sections ?? [],
    kpis: data.kpis ?? [],
    trends: data.trends ?? [],
    investmentOpportunities: data.investmentOpportunities ?? [],
    riskForecasts: data.riskForecasts ?? [],
    markdownExport: data.markdownExport ?? null,
    jsonExport: data.jsonExport ?? null,
    generatedAt: data.generatedAt ?? new Date(),
    exportedAt: data.exportedAt ?? null,
  }
  validateExecutiveReport(r)
  return r
}

export function createExecutiveDashboard(
  data: Omit<ExecutiveDashboard, 'id' | 'generatedAt'> & { id?: string; generatedAt?: Date }
): ExecutiveDashboard {
  if (!data.workspaceId || !data.workspaceId.trim())
    throw new Error('ExecutiveDashboard must have a workspaceId')
  if (!data.projectId || !data.projectId.trim())
    throw new Error('ExecutiveDashboard must have a projectId')
  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    healthSnapshot: data.healthSnapshot ?? null,
    trends: data.trends ?? [],
    marketSignals: data.marketSignals ?? [],
    investmentOpportunities: data.investmentOpportunities ?? [],
    riskForecasts: data.riskForecasts ?? [],
    roadmapInsights: data.roadmapInsights ?? [],
    generatedAt: data.generatedAt ?? new Date(),
  }
}

export function createTrendDetection(
  data: Omit<TrendDetection, 'id' | 'detectedAt'> & { id?: string; detectedAt?: Date }
): TrendDetection {
  if (!data.workspaceId || !data.workspaceId.trim())
    throw new Error('TrendDetection must have a workspaceId')
  if (!data.projectId || !data.projectId.trim())
    throw new Error('TrendDetection must have a projectId')
  if (!data.metricName || !data.metricName.trim())
    throw new Error('TrendDetection must have a metricName')
  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    metricName: data.metricName,
    direction: data.direction,
    magnitude: data.magnitude,
    percentageChange: data.percentageChange ?? null,
    dataPoints: data.dataPoints ?? [],
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    significance: data.significance,
    interpretation: data.interpretation,
    detectedAt: data.detectedAt ?? new Date(),
  }
}
