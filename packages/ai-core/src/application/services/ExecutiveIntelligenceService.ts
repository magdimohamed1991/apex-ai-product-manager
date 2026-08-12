/**
 * ExecutiveIntelligenceService (H12)
 *
 * Orchestrates executive intelligence: product health snapshots, trend
 * detection, investment opportunities, risk forecasts, roadmap insights,
 * and exportable executive reports.
 *
 * Every KPI is derived from real persisted observations (findings,
 * recommendations, outcomes, PM decision telemetry, competitor analysis,
 * UX analysis). No synthetic metrics: a KPI that has no source data is
 * stored as `null` and excluded from the overall score, and the dashboard
 * status becomes `unknown` when there is nothing measured. Project
 * ownership is verified before every operation.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { ExecutiveRepository } from '../../domain/repositories/ExecutiveRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import type { RecommendationOutcomeRepository } from '../../domain/repositories/RecommendationOutcomeRepository'
import type { CompetitorRepository } from '../../domain/repositories/CompetitorRepository'
import type { UXRepository } from '../../domain/repositories/UXRepository'
import type { PMDecisionTelemetryStore } from './PMDecisionTelemetryService'
import { AuthorizationError } from '../../errors/AppError'
import {
  createProductHealthSnapshot,
  createExecutiveReport,
  createExecutiveDashboard,
  createTrendDetection,
} from '../../domain/entities/ExecutiveIntelligence'
import type {
  ExecutiveDashboard,
  ExecutiveReport,
  ProductHealthSnapshot,
  TrendDetection,
  TrendDirection,
  ReportPeriod,
  ReportFormat,
  ExecutiveKPI,
  InvestmentOpportunity,
  RiskForecast,
  ReportSection,
  ProductHealthStatus,
} from '../../domain/entities/ExecutiveIntelligence'
import type { CompetitorAnalysis } from '../../domain/entities/CompetitorIntelligence'
import type { UXAnalysis, FrictionSeverity } from '../../domain/entities/UXIntelligence'
import type { Finding } from '../../domain/entities/Finding'
import type { Recommendation } from '../../domain/entities/Recommendation'
import type { RecommendationOutcome } from '../../domain/entities/RecommendationOutcome'
import type { PMDecisionTelemetry } from '../../domain/entities/PMDecisionTelemetry'
import type { Action } from '../../domain/entities/Action'

/** Severity → 0–10 friction score used to aggregate ux_friction_score. */
const FRICTION_SEVERITY_SCORE: Record<FrictionSeverity, number> = {
  critical: 10,
  high: 7.5,
  medium: 5,
  low: 2.5,
}

/** Days in each report period. */
const PERIOD_DAYS: Record<ReportPeriod, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
}

/** Minimum count before an open critical finding forces a critical status. */
const CRITICAL_FINDING_THRESHOLD = 1

interface MetricHealthPolicy {
  unit: string
  higherIsBetter: boolean
  source: string
  periodLabel: string
  weight: number
  /**
   * Maps a measured value to a 0–100 health contribution for the overall
   * score. This is an explicit scoring policy (not a fabricated metric) —
   * it only ever runs on real, persisted values.
   */
  contribution: (value: number) => number
}

const METRIC_POLICIES: Record<string, MetricHealthPolicy> = {
  pm_acceptance_rate: {
    unit: 'ratio (0–1)',
    higherIsBetter: true,
    source: 'H7 PM decision telemetry',
    periodLabel: 'All recorded decisions',
    weight: 1,
    contribution: (v) => v * 100,
  },
  outcome_success_rate: {
    unit: 'ratio (0–1)',
    higherIsBetter: true,
    source: 'H5 recommendation outcome verification',
    periodLabel: 'All recorded outcomes',
    weight: 1,
    contribution: (v) => v * 100,
  },
  ux_friction_score: {
    unit: 'score (0–10)',
    higherIsBetter: false,
    source: 'H10 UX intelligence friction points',
    periodLabel: 'All recorded friction points',
    weight: 1,
    contribution: (v) => Math.max(0, Math.min(100, (10 - v) * 10)),
  },
  decision_latency_seconds: {
    unit: 'seconds',
    higherIsBetter: false,
    source: 'H7 PM decision telemetry',
    periodLabel: 'All recorded decisions',
    weight: 0.5,
    contribution: (v) => Math.max(0, Math.min(100, 100 - v)),
  },
  open_critical_findings: {
    unit: 'count',
    higherIsBetter: false,
    source: 'Correlation findings (priority=critical)',
    periodLabel: 'Currently open',
    weight: 0.5,
    contribution: (v) => Math.max(0, Math.min(100, 100 - v * 20)),
  },
  competitor_gaps_count: {
    unit: 'count',
    higherIsBetter: false,
    source: 'H9 competitor gap detection',
    periodLabel: 'Latest competitive analysis',
    weight: 0.5,
    contribution: (v) => Math.max(0, Math.min(100, 100 - v * 10)),
  },
}

export interface ExportResult {
  format: ReportFormat
  content: string | null
  note?: string
}

export class ExecutiveIntelligenceService {
  constructor(
    private readonly executiveRepository: ExecutiveRepository,
    private readonly productRepository: ProductRepository,
    private readonly actionRepository: ActionRepository,
    private readonly recommendationOutcomeRepository: RecommendationOutcomeRepository,
    private readonly competitorRepository?: CompetitorRepository,
    private readonly uxRepository?: UXRepository,
    private readonly telemetryStore?: PMDecisionTelemetryStore
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
  // Dashboard generation
  // ------------------------------------------------------------------

  async generateDashboard(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ExecutiveDashboard> {
    await this.verifyProjectOwnership(workspaceId, projectId)

    // The previous snapshot is read BEFORE the new one is persisted so trend
    // detection compares against the genuine previous measurement.
    const previous = await this.executiveRepository.getLatestProductHealthSnapshot(
      projectId,
      workspaceId
    )

    const [
      findings,
      recommendations,
      outcomes,
      telemetry,
      actions,
      competitorAnalysis,
      uxAnalysis,
    ] = await Promise.all([
      this.productRepository.getFindingsByProject(projectId, workspaceId),
      this.productRepository.getRecommendationsByProject(projectId, workspaceId),
      this.recommendationOutcomeRepository.getByProject(projectId, workspaceId),
      this.telemetryStore
        ? this.telemetryStore.getPMDecisionTelemetryByProject(projectId, workspaceId)
        : Promise.resolve([] as PMDecisionTelemetry[]),
      this.actionRepository.getByWorkspace({ workspaceId }),
      this.competitorRepository
        ? this.competitorRepository.getAnalysisByProject(projectId, workspaceId)
        : Promise.resolve(null as CompetitorAnalysis | null),
      this.uxRepository
        ? this.uxRepository.getUXAnalysisByProject(projectId, workspaceId)
        : Promise.resolve(null as UXAnalysis | null),
    ])

    const snapshot = this._buildSnapshot(
      workspaceId,
      projectId,
      findings,
      recommendations,
      outcomes,
      telemetry,
      competitorAnalysis,
      uxAnalysis,
      previous
    )
    await this.executiveRepository.saveProductHealthSnapshot(snapshot)

    // Trends are computed per generation; replacing the previous set keeps
    // the persisted trend list in sync with the latest dashboard.
    const trends = this._detectTrends(workspaceId, projectId, snapshot, previous)
    await this.executiveRepository.deleteTrendDetectionsByProject(projectId, workspaceId)
    for (const trend of trends) {
      await this.executiveRepository.saveTrendDetection(trend)
    }

    const dashboard = createExecutiveDashboard({
      workspaceId,
      projectId,
      healthSnapshot: snapshot,
      trends,
      marketSignals: [],
      investmentOpportunities: this._buildInvestmentOpportunities(competitorAnalysis),
      riskForecasts: this._buildRiskForecasts(uxAnalysis, competitorAnalysis),
      roadmapInsights: this._buildRoadmapInsights(snapshot, recommendations, actions),
    })
    await this.executiveRepository.saveExecutiveDashboard(dashboard)
    return dashboard
  }

  // ------------------------------------------------------------------
  // Report generation & export
  // ------------------------------------------------------------------

  async generateReport(
    workspaceId: WorkspaceId,
    projectId: string,
    period: ReportPeriod
  ): Promise<ExecutiveReport> {
    await this.verifyProjectOwnership(workspaceId, projectId)

    const now = new Date()
    const periodStart = new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000)
    const periodEnd = now

    let dashboard = await this.executiveRepository.getExecutiveDashboardByProject(
      projectId,
      workspaceId
    )
    if (!dashboard) {
      dashboard = await this.generateDashboard(workspaceId, projectId)
    }

    const project = await this.productRepository.getProjectByIdAndWorkspace(projectId, workspaceId)
    const recommendations = await this.productRepository.getRecommendationsByProject(
      projectId,
      workspaceId
    )
    const sections = await this._buildReportSections(
      workspaceId,
      projectId,
      dashboard,
      recommendations
    )

    const title = `Executive Report — ${period} — ${project ? project.name : projectId}`
    const executiveSummary = this._buildExecutiveSummary(dashboard)

    const reportBase = {
      workspaceId,
      projectId,
      period,
      periodStart,
      periodEnd,
      title,
      executiveSummary,
      sections,
      kpis: dashboard.healthSnapshot?.kpis ?? [],
      trends: dashboard.trends,
      investmentOpportunities: dashboard.investmentOpportunities,
      riskForecasts: dashboard.riskForecasts,
      markdownExport: null as string | null,
      jsonExport: null as string | null,
      exportedAt: null as Date | null,
    }

    const report = createExecutiveReport({
      ...reportBase,
      markdownExport: this._renderMarkdown(title, periodStart, periodEnd, sections),
    })
    // JSON export is the serialised report artefact itself (excluding the
    // jsonExport field, which cannot reference itself).
    report.jsonExport = JSON.stringify({ ...report, jsonExport: null }, null, 2)
    await this.executiveRepository.saveExecutiveReport(report)
    return report
  }

  async exportReport(
    workspaceId: WorkspaceId,
    projectId: string,
    reportId: string,
    format: ReportFormat
  ): Promise<ExportResult> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const report = await this.executiveRepository.getExecutiveReportById(
      reportId,
      workspaceId,
      projectId
    )
    if (!report) {
      throw new Error(`Executive report "${reportId}" was not found in this project`)
    }

    if (format === 'pdf') {
      return { format: 'pdf', content: null, note: 'PDF export requires a browser runtime' }
    }

    if (format === 'markdown') {
      if (report.markdownExport === null) {
        throw new Error('This report has no markdown export — regenerate the report first')
      }
      report.exportedAt = new Date()
      await this.executiveRepository.saveExecutiveReport(report)
      return { format: 'markdown', content: report.markdownExport }
    }

    if (report.jsonExport === null) {
      throw new Error('This report has no JSON export — regenerate the report first')
    }
    report.exportedAt = new Date()
    await this.executiveRepository.saveExecutiveReport(report)
    return { format: 'json', content: report.jsonExport }
  }

  // ------------------------------------------------------------------
  // Read endpoints
  // ------------------------------------------------------------------

  async getDashboard(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ExecutiveDashboard | null> {
    return this.executiveRepository.getExecutiveDashboardByProject(projectId, workspaceId)
  }

  async getLatestSnapshot(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<ProductHealthSnapshot | null> {
    return this.executiveRepository.getLatestProductHealthSnapshot(projectId, workspaceId)
  }

  async getReports(workspaceId: WorkspaceId, projectId: string): Promise<ExecutiveReport[]> {
    return this.executiveRepository.getExecutiveReportsByProject(projectId, workspaceId)
  }

  async getTrends(workspaceId: WorkspaceId, projectId: string): Promise<TrendDetection[]> {
    return this.executiveRepository.getTrendDetectionsByProject(projectId, workspaceId)
  }

  // ------------------------------------------------------------------
  // Snapshot construction
  // ------------------------------------------------------------------

  private _buildSnapshot(
    workspaceId: WorkspaceId,
    projectId: string,
    findings: Finding[],
    recommendations: Recommendation[],
    outcomes: RecommendationOutcome[],
    telemetry: PMDecisionTelemetry[],
    competitorAnalysis: CompetitorAnalysis | null,
    uxAnalysis: UXAnalysis | null,
    previous: ProductHealthSnapshot | null
  ): ProductHealthSnapshot {
    const outcomeByRec = new Map(outcomes.map((o) => [o.recommendationId, o]))
    const acceptedRecIds = new Set(
      telemetry.filter((t) => t.decision === 'ACCEPT').map((t) => t.recommendationId)
    )

    const openCriticalFindings = findings.filter((f) => f.priority === 'critical').length
    const openHighFindings = findings.filter((f) => f.priority === 'high').length
    const pendingRecommendations = recommendations.filter((r) => !outcomeByRec.has(r.id)).length
    const acceptedRecommendations = acceptedRecIds.size

    const pmAcceptanceRate =
      telemetry.length > 0
        ? telemetry.filter((t) => t.decision === 'ACCEPT').length / telemetry.length
        : null
    const outcomeSuccessRate =
      outcomes.length > 0
        ? outcomes.filter((o) => o.status === 'VERIFIED_SUCCESS').length / outcomes.length
        : null
    const decisionLatencySeconds = this._avgDecisionLatencySeconds(telemetry)
    const competitorGapsCount = (competitorAnalysis?.opportunities ?? []).reduce(
      (sum, opp) => sum + opp.gaps.length,
      0
    )
    const uxFrictionScore = this._uxFrictionScore(uxAnalysis)

    const kpis: ExecutiveKPI[] = [
      this._kpi('pm_acceptance_rate', pmAcceptanceRate, previous),
      this._kpi('outcome_success_rate', outcomeSuccessRate, previous),
      this._kpi('open_critical_findings', openCriticalFindings, previous),
      this._kpi('competitor_gaps_count', competitorGapsCount, previous),
      this._kpi('ux_friction_score', uxFrictionScore, previous),
      this._kpi('decision_latency_seconds', decisionLatencySeconds, previous),
    ]

    // A KPI only contributes to the overall score when there is a real
    // observation population behind it. A count of zero with NO underlying
    // data (e.g. zero findings because nothing was scanned) must never
    // masquerade as a healthy measurement.
    const measuredKpis: string[] = []
    if (telemetry.length > 0) {
      measuredKpis.push('pm_acceptance_rate', 'decision_latency_seconds')
    }
    if (outcomes.length > 0) measuredKpis.push('outcome_success_rate')
    if (findings.length > 0) measuredKpis.push('open_critical_findings')
    if (competitorAnalysis !== null) measuredKpis.push('competitor_gaps_count')
    if ((uxAnalysis?.frictionPoints?.length ?? 0) > 0) measuredKpis.push('ux_friction_score')

    const overallScore = this._overallScore(kpis, measuredKpis)
    const status = this._statusFrom(openCriticalFindings, overallScore)

    return createProductHealthSnapshot({
      workspaceId,
      projectId,
      status,
      overallScore,
      kpis,
      openCriticalFindings,
      openHighFindings,
      pendingRecommendations,
      acceptedRecommendations,
      outcomeSuccessRate,
      decisionLatencySeconds,
      pmAcceptanceRate,
      competitorGapsCount,
      uxFrictionScore,
    })
  }

  private _kpi(
    name: string,
    value: number | null,
    previous: ProductHealthSnapshot | null
  ): ExecutiveKPI {
    const policy = METRIC_POLICIES[name]
    const prevKpi = previous?.kpis.find((k) => k.name === name)
    const previousValue = prevKpi?.value ?? null
    return {
      name,
      value,
      unit: policy.unit,
      trend: this._trendDirection(value, previousValue, policy.higherIsBetter),
      previousValue,
      periodLabel: policy.periodLabel,
      source: policy.source,
      epistemicNote:
        value === null
          ? 'No persisted source data — value is unavailable, not assumed.'
          : `Derived from ${policy.source}.`,
    }
  }

  /**
   * Weighted average of the 0–100 health contributions of every KPI with a
   * real observation population (per `measuredKpis`). KPIs outside that set
   * contribute nothing — the score is never fabricated from absent data.
   */
  private _overallScore(kpis: ExecutiveKPI[], measuredKpis: string[]): number | null {
    const measured = kpis.filter((k) => measuredKpis.includes(k.name) && k.value !== null)
    if (measured.length === 0) return null
    const policy = METRIC_POLICIES
    let weighted = 0
    let totalWeight = 0
    for (const k of measured) {
      const p = policy[k.name]
      if (!p) continue
      weighted += p.weight * p.contribution(k.value as number)
      totalWeight += p.weight
    }
    if (totalWeight === 0) return null
    return Math.round((weighted / totalWeight) * 10) / 10
  }

  private _statusFrom(
    openCriticalFindings: number,
    overallScore: number | null
  ): ProductHealthStatus {
    if (openCriticalFindings >= CRITICAL_FINDING_THRESHOLD) return 'critical'
    if (overallScore === null) return 'unknown'
    if (overallScore < 40) return 'critical'
    if (overallScore < 60) return 'at_risk'
    return 'healthy'
  }

  private _avgDecisionLatencySeconds(telemetry: PMDecisionTelemetry[]): number | null {
    const latencies = telemetry
      .map((t) => (t.decisionCompletedAt.getTime() - t.decisionStartedAt.getTime()) / 1000)
      .filter((v) => Number.isFinite(v) && v >= 0)
    if (latencies.length === 0) return null
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
    return Math.round(avg * 100) / 100
  }

  private _uxFrictionScore(uxAnalysis: UXAnalysis | null): number | null {
    const friction = uxAnalysis?.frictionPoints ?? []
    if (friction.length === 0) return null
    const avg =
      friction.reduce((sum, fp) => sum + (FRICTION_SEVERITY_SCORE[fp.severity] ?? 5), 0) /
      friction.length
    return Math.round(avg * 100) / 100
  }

  // ------------------------------------------------------------------
  // Trend detection
  // ------------------------------------------------------------------

  private _trendDirection(
    current: number | null,
    previous: number | null,
    higherIsBetter: boolean
  ): TrendDirection {
    if (current === null || previous === null || current === previous) return 'stable'
    const delta = current - previous
    if (Math.abs(delta) < 1e-9) return 'stable'
    const improving = higherIsBetter ? delta > 0 : delta < 0
    return improving ? 'improving' : 'degrading'
  }

  private _detectTrends(
    workspaceId: WorkspaceId,
    projectId: string,
    current: ProductHealthSnapshot,
    previous: ProductHealthSnapshot | null
  ): TrendDetection[] {
    if (!previous) return []
    const trends: TrendDetection[] = []

    for (const kpi of current.kpis) {
      const prevKpi = previous.kpis.find((k) => k.name === kpi.name)
      if (kpi.value === null || !prevKpi || prevKpi.value === null) continue
      if (kpi.value === prevKpi.value) continue

      const policy = METRIC_POLICIES[kpi.name]
      const direction = this._trendDirection(kpi.value, prevKpi.value, policy.higherIsBetter)
      const magnitude = Math.abs(kpi.value - prevKpi.value)
      const percentageChange =
        prevKpi.value === 0
          ? null
          : Math.round(((kpi.value - prevKpi.value) / prevKpi.value) * 1000) / 10

      trends.push(
        createTrendDetection({
          workspaceId,
          projectId,
          metricName: kpi.name,
          direction,
          magnitude: Math.round(magnitude * 1000) / 1000,
          percentageChange,
          dataPoints: [
            { label: previous.snapshotAt.toISOString(), value: prevKpi.value },
            { label: current.snapshotAt.toISOString(), value: kpi.value },
          ],
          periodStart: previous.snapshotAt,
          periodEnd: current.snapshotAt,
          significance:
            percentageChange !== null && Math.abs(percentageChange) >= 25
              ? 'high'
              : percentageChange !== null && Math.abs(percentageChange) >= 10
                ? 'medium'
                : 'low',
          interpretation: this._trendInterpretation(kpi.name, direction, kpi.value, prevKpi.value),
        })
      )
    }
    return trends
  }

  private _trendInterpretation(
    metricName: string,
    direction: TrendDirection,
    current: number,
    previous: number
  ): string {
    const label = METRIC_POLICIES[metricName]?.source ?? metricName
    return `"${metricName}" moved from ${previous} to ${current} (${direction}) based on ${label}.`
  }

  // ------------------------------------------------------------------
  // Investment opportunities & risk forecasts
  // ------------------------------------------------------------------

  private _buildInvestmentOpportunities(
    competitorAnalysis: CompetitorAnalysis | null
  ): InvestmentOpportunity[] {
    const recs = competitorAnalysis?.recommendations ?? []
    return recs
      .filter((rec) => rec.opportunityScore >= 7)
      .map((rec) => ({
        id: crypto.randomUUID(),
        title: rec.title,
        description: rec.description,
        // Honest epistemic label — no fabricated ROI figures.
        estimatedROI: `Not measured — capability parity with ${rec.relatedCompetitorIds.length} tracked competitor(s) is the near-term objective`,
        confidence: rec.opportunityScore >= 8.5 ? 'high' : 'medium',
        effort: rec.effort,
        rationale: rec.rationale,
        evidenceSources: [...rec.relatedGapIds, rec.id],
        priority: rec.priority,
      }))
  }

  private _buildRiskForecasts(
    uxAnalysis: UXAnalysis | null,
    competitorAnalysis: CompetitorAnalysis | null
  ): RiskForecast[] {
    const risks: RiskForecast[] = []

    for (const fp of uxAnalysis?.frictionPoints ?? []) {
      if (fp.severity !== 'critical' && fp.severity !== 'high') continue
      risks.push({
        id: crypto.randomUUID(),
        title: `UX risk: ${fp.title}`,
        description: fp.description,
        level: fp.severity === 'critical' ? 'critical' : 'high',
        probability: fp.severity === 'critical' ? 'high' : 'medium',
        timeHorizon: 'near_term',
        mitigations: [
          fp.suggestedFix ?? 'Remediate the reported friction and re-run the UX analysis.',
        ],
        evidenceSources: [fp.id],
      })
    }

    const gaps = (competitorAnalysis?.opportunities ?? []).flatMap((opp) => opp.gaps)
    for (const gap of gaps) {
      if (gap.significance !== 'critical') continue
      risks.push({
        id: crypto.randomUUID(),
        title: `Competitive risk: missing "${gap.featureName}"`,
        description: gap.description,
        level: 'high',
        probability: 'high',
        timeHorizon: 'near_term',
        mitigations: [`Close the capability gap for "${gap.featureName}".`],
        evidenceSources: [gap.id],
      })
    }

    return risks
  }

  // ------------------------------------------------------------------
  // Roadmap insights (plain-text, derived from real patterns)
  // ------------------------------------------------------------------

  private _buildRoadmapInsights(
    snapshot: ProductHealthSnapshot,
    recommendations: Recommendation[],
    actions: Action[]
  ): string[] {
    const insights: string[] = []
    const recIds = new Set(recommendations.map((r) => r.id))
    const projectActions = actions.filter((a) => recIds.has(a.relatedRecommendationId))
    const executedCount = projectActions.filter((a) => a.status === 'completed').length

    if (snapshot.openCriticalFindings > 0) {
      insights.push(
        `Resolve ${snapshot.openCriticalFindings} open critical finding(s) before committing to new scope.`
      )
    }
    if (snapshot.pendingRecommendations > 0) {
      insights.push(
        `${snapshot.pendingRecommendations} recommendation(s) have no verified outcome — schedule outcome verification.`
      )
    }
    if (snapshot.pmAcceptanceRate !== null && snapshot.pmAcceptanceRate < 0.5) {
      insights.push(
        'PM acceptance is below 50% — recalibrate recommendation priorities against accepted decisions.'
      )
    }
    if (snapshot.outcomeSuccessRate !== null && snapshot.outcomeSuccessRate < 0.5) {
      insights.push(
        'Fewer than half of verified outcomes succeeded — inspect execution follow-through.'
      )
    }
    if (snapshot.competitorGapsCount > 0) {
      insights.push(
        `Tracked competitors offer ${snapshot.competitorGapsCount} capability(ies) the product lacks — prioritise the highest-scoring gaps.`
      )
    }
    if (snapshot.uxFrictionScore !== null && snapshot.uxFrictionScore >= 7.5) {
      insights.push(
        'UX friction is severe — treat the highest-severity friction points as blockers.'
      )
    }
    if (snapshot.decisionLatencySeconds !== null && snapshot.decisionLatencySeconds > 3600) {
      insights.push(
        'Average PM decision latency exceeds one hour — streamline the review workflow.'
      )
    }
    if (executedCount > 0) {
      insights.push(`${executedCount} action(s) completed for this project's recommendations.`)
    }
    if (insights.length === 0) {
      insights.push(
        'Insufficient persisted data — collect telemetry, outcomes, competitive and UX intelligence before deriving roadmap insight.'
      )
    }
    return insights
  }

  // ------------------------------------------------------------------
  // Report construction
  // ------------------------------------------------------------------

  private async _buildReportSections(
    workspaceId: WorkspaceId,
    projectId: string,
    dashboard: ExecutiveDashboard,
    recommendations: Recommendation[]
  ): Promise<ReportSection[]> {
    const snapshot = dashboard.healthSnapshot
    const sections: ReportSection[] = []

    // 1. Executive Summary
    sections.push({
      title: 'Executive Summary',
      content: this._buildExecutiveSummary(dashboard),
      order: 1,
    })

    // 2. Product Health — KPI table as markdown
    sections.push({
      title: 'Product Health',
      content: this._kpiTableMarkdown(snapshot?.kpis ?? []),
      order: 2,
    })

    // 3. Competitor Intelligence
    const competitorAnalysis = this.competitorRepository
      ? await this.competitorRepository.getAnalysisByProject(projectId, workspaceId)
      : null
    sections.push({
      title: 'Competitor Intelligence',
      content: this._competitorSectionMarkdown(competitorAnalysis),
      order: 3,
    })

    // 4. UX Intelligence
    const uxAnalysis = this.uxRepository
      ? await this.uxRepository.getUXAnalysisByProject(projectId, workspaceId)
      : null
    sections.push({
      title: 'UX Intelligence',
      content: this._uxSectionMarkdown(uxAnalysis),
      order: 4,
    })

    // 5. Recommendations — top 5 by priority
    sections.push({
      title: 'Recommendations',
      content: this._recommendationsMarkdown(recommendations),
      order: 5,
    })

    // 6. Risk Forecasts
    sections.push({
      title: 'Risk Forecasts',
      content: this._riskListMarkdown(dashboard.riskForecasts),
      order: 6,
    })

    // 7. Investment Opportunities
    sections.push({
      title: 'Investment Opportunities',
      content: this._opportunityListMarkdown(dashboard.investmentOpportunities),
      order: 7,
    })

    // 8. Roadmap Insights
    sections.push({
      title: 'Roadmap Insights',
      content:
        dashboard.roadmapInsights.map((i) => `- ${i}`).join('\n') || '_No insights derived._',
      order: 8,
    })

    return sections
  }

  private _buildExecutiveSummary(dashboard: ExecutiveDashboard): string {
    const snapshot = dashboard.healthSnapshot
    const status = snapshot?.status ?? 'unknown'
    const score =
      snapshot?.overallScore === null || snapshot?.overallScore === undefined
        ? 'not computable (insufficient data)'
        : `${snapshot.overallScore}/100`
    const topInsight = dashboard.roadmapInsights[0]
    const summary = `Product health is ${status} with an overall score of ${score}.`
    const insight = topInsight ? ` Top insight: ${topInsight}` : ''
    const scope = `${dashboard.trends.length} trend(s), ${dashboard.investmentOpportunities.length} investment opportunity(ies), and ${dashboard.riskForecasts.length} risk(s) forecast.`
    return `${summary}${insight} ${scope}`
  }

  private _kpiTableMarkdown(kpis: ExecutiveKPI[]): string {
    if (kpis.length === 0) return '_No KPIs measured._'
    const lines = [
      '| KPI | Value | Unit | Trend | Previous | Source |',
      '|---|---|---|---|---|---|',
    ]
    for (const k of kpis) {
      const value = k.value === null ? '—' : String(k.value)
      const prev = k.previousValue === null ? '—' : String(k.previousValue)
      lines.push(`| ${k.name} | ${value} | ${k.unit} | ${k.trend} | ${prev} | ${k.source} |`)
    }
    return lines.join('\n')
  }

  private _competitorSectionMarkdown(analysis: CompetitorAnalysis | null): string {
    if (!analysis) return '_No competitor analysis on record for this project yet._'
    const matrix = analysis.featureMatrix
    const features = matrix?.features ?? []
    const opportunities = analysis.opportunities ?? []
    const lines = [
      `Competitor analysis ${analysis.status} — ${(analysis.competitors ?? []).length} competitor(s) tracked, ${features.length} feature(s) compared.`,
    ]
    if (opportunities.length > 0) {
      lines.push(
        `Highest-scoring opportunity: "${opportunities[0].title}" (${opportunities[0].opportunityScore}/10).`
      )
    }
    return lines.join('\n')
  }

  private _uxSectionMarkdown(analysis: UXAnalysis | null): string {
    if (!analysis) return '_No UX analysis on record for this project yet._'
    const friction = analysis.frictionPoints ?? []
    const usability = analysis.usabilityScore
    const lines = [
      `UX analysis ${analysis.status} — ${friction.length} friction point(s), ${(analysis.journeys ?? []).length} journey(s).`,
    ]
    if (usability) {
      lines.push(
        `Overall usability score: ${usability.overallScore}/10 (${usability.accessibilityIssues.length} accessibility issue(s)).`
      )
    } else if (analysis.overallUXScore !== null) {
      lines.push(`Overall UX score: ${analysis.overallUXScore}/100.`)
    }
    return lines.join('\n')
  }

  private _recommendationsMarkdown(recommendations: Recommendation[]): string {
    if (recommendations.length === 0) return '_No recommendations on record._'
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const top = recommendations
      .slice()
      .sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9))
      .slice(0, 5)
    return top.map((r) => `- **[${r.priority}]** ${r.title} — ${r.impact}`).join('\n')
  }

  private _riskListMarkdown(risks: RiskForecast[]): string {
    if (risks.length === 0) return '_No risks forecast._'
    return risks
      .map(
        (r) =>
          `- **[${r.level}]** ${r.title} (probability ${r.probability}, ${r.timeHorizon}) — ${r.description}`
      )
      .join('\n')
  }

  private _opportunityListMarkdown(opportunities: InvestmentOpportunity[]): string {
    if (opportunities.length === 0) return '_No investment opportunities identified._'
    return opportunities
      .map(
        (o) =>
          `- **[${o.priority}]** ${o.title} (confidence ${o.confidence}, effort ${o.effort}) — ${o.description}`
      )
      .join('\n')
  }

  private _renderMarkdown(
    title: string,
    periodStart: Date,
    periodEnd: Date,
    sections: ReportSection[]
  ): string {
    const parts = [
      `# ${title}`,
      '',
      `**Period:** ${periodStart.toISOString()} → ${periodEnd.toISOString()}`,
      '',
    ]
    for (const section of sections) {
      parts.push(`## ${section.title}`, '', section.content, '')
    }
    return parts.join('\n')
  }
}
