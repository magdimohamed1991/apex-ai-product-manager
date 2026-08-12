/**
 * UXIntelligenceService (H10)
 *
 * Orchestrates UX intelligence: user journeys, friction points, usability
 * scoring (Nielsen-inspired dimensions), task completion analysis, and UX
 * recommendations. Every value is derived from persisted observations — no
 * synthetic metrics.
 *
 * Project ownership is verified against the product repository before any
 * operation, preserving tenancy and project isolation.
 */
import type { WorkspaceId } from '../../domain/value-objects'
import type { UXRepository } from '../../domain/repositories/UXRepository'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { BrowserIntelligenceRepository } from '../../domain/repositories/BrowserIntelligenceRepository'
import { AuthorizationError } from '../../errors/AppError'
import {
  createUXAnalysis,
  createUserJourney,
  createFrictionPoint,
  createUXRecommendation,
} from '../../domain/entities/UXIntelligence'
import type {
  UserJourney,
  JourneyStep,
  FrictionPoint,
  FrictionSeverity,
  UXAnalysis,
  UXRecommendation,
  UsabilityScore,
  UsabilityDimensionScore,
  AccessibilityIssue,
  InteractionAnalysis,
  InteractionEvent,
  TaskCompletionAnalysis,
  UXDimension,
} from '../../domain/entities/UXIntelligence'
import type { LearningSignal } from '../../domain/entities/ProductAdaptive'

export interface AddUserJourneyInput {
  name: string
  description: string
  startUrl?: string | null
  goalUrl?: string | null
  steps?: JourneyStep[]
  completionRate?: number | null
  averageDurationMs?: number | null
  navigationPattern?: UserJourney['navigationPattern']
  dataSource?: UserJourney['dataSource']
}

export interface AddFrictionPointInput {
  journeyId?: string | null
  stepId?: string | null
  title: string
  description: string
  severity: FrictionSeverity
  category: string
  url?: string | null
  evidence?: string[]
  suggestedFix?: string | null
  estimatedImpact?: FrictionPoint['estimatedImpact']
}

const SEVERITY_WEIGHT: Record<FrictionSeverity, number> = {
  critical: 10,
  high: 7.5,
  medium: 5,
  low: 2.5,
}

const UX_DIMENSIONS: UXDimension[] = [
  'learnability',
  'efficiency',
  'memorability',
  'error_prevention',
  'satisfaction',
  'accessibility',
]

export class UXIntelligenceService {
  constructor(
    private readonly uxRepository: UXRepository,
    private readonly productRepository: ProductRepository,
    private readonly browserIntelligenceRepository?: BrowserIntelligenceRepository
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
  // Journey & friction point registration
  // ------------------------------------------------------------------

  async addUserJourney(
    workspaceId: WorkspaceId,
    projectId: string,
    input: AddUserJourneyInput
  ): Promise<UserJourney> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const journey = createUserJourney({
      workspaceId,
      projectId,
      name: input.name,
      description: input.description,
      startUrl: input.startUrl ?? null,
      goalUrl: input.goalUrl ?? null,
      steps: input.steps ?? [],
      completionRate: input.completionRate ?? null,
      averageDurationMs: input.averageDurationMs ?? null,
      navigationPattern: input.navigationPattern ?? null,
      dataSource: input.dataSource ?? 'manual',
    })
    await this.uxRepository.saveUserJourney(journey)
    return journey
  }

  async addFrictionPoint(
    workspaceId: WorkspaceId,
    projectId: string,
    input: AddFrictionPointInput
  ): Promise<FrictionPoint> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const fp = createFrictionPoint({
      workspaceId,
      projectId,
      journeyId: input.journeyId ?? null,
      stepId: input.stepId ?? null,
      title: input.title,
      description: input.description,
      severity: input.severity,
      category: input.category,
      url: input.url ?? null,
      evidence: input.evidence ?? [],
      suggestedFix: input.suggestedFix ?? null,
      estimatedImpact: input.estimatedImpact ?? 'medium',
    })
    await this.uxRepository.saveFrictionPoint(fp)
    return fp
  }

  // ------------------------------------------------------------------
  // Analysis execution
  // ------------------------------------------------------------------

  async runUXAnalysis(workspaceId: WorkspaceId, projectId: string): Promise<UXAnalysis> {
    await this.verifyProjectOwnership(workspaceId, projectId)
    const [journeys, frictionPoints] = await Promise.all([
      this.uxRepository.getUserJourneysByProject(projectId, workspaceId),
      this.uxRepository.getFrictionPointsByProject(projectId, workspaceId),
    ])

    const analysis = createUXAnalysis({
      workspaceId,
      projectId,
      status: 'running',
      journeys,
      frictionPoints,
      interactionAnalysis: null,
      usabilityScore: null,
      taskCompletionAnalyses: [],
      overallUXScore: null,
      completedAt: null,
      error: null,
    })
    await this.uxRepository.saveUXAnalysis(analysis)

    try {
      const interactionAnalysis = await this._buildInteractionAnalysis(workspaceId, projectId)
      // An interaction analysis with zero events carries no observations and
      // must never masquerade as evidence for a healthy score.
      const hasEvidence =
        journeys.length > 0 ||
        frictionPoints.length > 0 ||
        (interactionAnalysis !== null && interactionAnalysis.events.length > 0)
      const usabilityScore = hasEvidence
        ? this._computeUsabilityScore(workspaceId, projectId, frictionPoints)
        : null
      const taskCompletionAnalyses = journeys.map((j) => this._buildTaskCompletionAnalysis(j))

      const recommendations = this._generateRecommendations(
        workspaceId,
        projectId,
        frictionPoints,
        journeys
      )
      for (const rec of recommendations) {
        await this.uxRepository.saveUXRecommendation(rec)
      }

      analysis.interactionAnalysis = interactionAnalysis
      analysis.usabilityScore = usabilityScore
      analysis.taskCompletionAnalyses = taskCompletionAnalyses
      analysis.overallUXScore =
        usabilityScore !== null ? Math.round(usabilityScore.overallScore * 10 * 10) / 10 : null
      analysis.status = 'completed'
      analysis.completedAt = new Date()
      await this.uxRepository.saveUXAnalysis(analysis)
      return analysis
    } catch (err) {
      analysis.status = 'failed'
      analysis.completedAt = new Date()
      analysis.error = err instanceof Error ? err.message : String(err)
      await this.uxRepository.saveUXAnalysis(analysis)
      throw err
    }
  }

  // ------------------------------------------------------------------
  // Read endpoints
  // ------------------------------------------------------------------

  async getUXAnalysis(workspaceId: WorkspaceId, projectId: string): Promise<UXAnalysis | null> {
    return this.uxRepository.getUXAnalysisByProject(projectId, workspaceId)
  }

  async getJourneys(workspaceId: WorkspaceId, projectId: string): Promise<UserJourney[]> {
    return this.uxRepository.getUserJourneysByProject(projectId, workspaceId)
  }

  async getFrictionPoints(workspaceId: WorkspaceId, projectId: string): Promise<FrictionPoint[]> {
    return this.uxRepository.getFrictionPointsByProject(projectId, workspaceId)
  }

  async getUXRecommendations(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<UXRecommendation[]> {
    return this.uxRepository.getUXRecommendationsByProject(projectId, workspaceId)
  }

  /**
   * H6/H7 integration: maps persisted UX recommendations into the H6
   * calibration pipeline. Every recommendation with priority `critical` or
   * `high` yields one auditable LearningSignal (type CALIBRATION, labeled
   * UX_ADJUSTMENT_HINT) that callers may append to a calibration's
   * `appliedSignals` so the explanation surfaces the UX evidence. Lower
   * priority recommendations are excluded — the hint is only surfaced for
   * genuinely impactful UX findings.
   */
  async getUXCalibrationSignals(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<LearningSignal[]> {
    const recommendations = await this.uxRepository.getUXRecommendationsByProject(
      projectId,
      workspaceId
    )
    const signals: LearningSignal[] = []
    for (const rec of recommendations) {
      if (rec.priority !== 'critical' && rec.priority !== 'high') continue
      const value = rec.priority === 'critical' ? 0.9 : 0.75
      signals.push({
        id: `uxhint-${rec.id}`,
        workspaceId,
        projectId,
        category: 'UX',
        type: 'CALIBRATION',
        observationCount: 1,
        value,
        confidence: 0.6,
        sourceRecommendationIds: rec.relatedJourneyIds,
        generatedAt: rec.createdAt,
        evidenceState: 'observed',
        calibrationVersion: 'ux-hint-v1',
      })
    }
    return signals
  }

  // ------------------------------------------------------------------
  // Analysis builders
  // ------------------------------------------------------------------

  /**
   * Build the InteractionAnalysis from crawled page data when a browser
   * intelligence repository is present. Only `navigation`-type extracted
   * data contributes interaction events; if the runtime produced none, the
   * analysis carries an empty event set (no fabricated interactions).
   */
  private async _buildInteractionAnalysis(
    workspaceId: WorkspaceId,
    projectId: string
  ): Promise<InteractionAnalysis | null> {
    if (!this.browserIntelligenceRepository) return null
    const pages = await this.browserIntelligenceRepository.getCrawledPagesByProject(
      projectId,
      workspaceId
    )
    const events: InteractionEvent[] = []
    for (const page of pages) {
      for (const data of page.extractedData) {
        if (data.type !== 'navigation') continue
        const rawEvents = Array.isArray(data.content?.events)
          ? (data.content.events as unknown[])
          : Array.isArray(data.content?.interactions)
            ? (data.content.interactions as unknown[])
            : []
        for (const raw of rawEvents) {
          const ev = raw as Partial<InteractionEvent>
          if (typeof ev.element === 'string' && typeof ev.eventType === 'string') {
            events.push({
              element: ev.element,
              eventType: (ev.eventType as InteractionEvent['eventType']) ?? 'click',
              count: typeof ev.count === 'number' ? ev.count : 1,
              averageDurationMs:
                typeof ev.averageDurationMs === 'number' ? ev.averageDurationMs : null,
            })
          }
        }
      }
    }

    const counts = new Map<string, number>()
    for (const ev of events) {
      counts.set(ev.element, (counts.get(ev.element) ?? 0) + ev.count)
    }
    const topInteractions = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([element]) => element)

    return {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      url: pages.length > 0 ? pages[0].url : null,
      events,
      topInteractions,
      deadClicks: [],
      rageClicks: [],
      analyzedAt: new Date(),
    }
  }

  /**
   * Compute the UsabilityScore from friction point severities. Each
   * dimension starts at a 10 baseline and is deducted per observed friction:
   *   - critical severity → efficiency and learnability
   *   - form_design category → efficiency (blocked completion flows)
   *   - navigation category → efficiency and learnability
   *   - content_clarity category → memorability
   *   - accessibility-related friction → accessibility + AccessibilityIssue
   * With zero evidence the score is null (never a fabricated healthy score).
   */
  private _computeUsabilityScore(
    workspaceId: WorkspaceId,
    projectId: string,
    frictionPoints: FrictionPoint[]
  ): UsabilityScore {
    const dimensionScores: Record<UXDimension, number> = {
      learnability: 10,
      efficiency: 10,
      memorability: 10,
      error_prevention: 10,
      satisfaction: 10,
      accessibility: 10,
    }
    const accessibilityIssues: AccessibilityIssue[] = []
    const evidenceByDimension: Record<UXDimension, string[]> = {
      learnability: [],
      efficiency: [],
      memorability: [],
      error_prevention: [],
      satisfaction: [],
      accessibility: [],
    }

    for (const fp of frictionPoints) {
      const weight = SEVERITY_WEIGHT[fp.severity] ?? 5
      const deduction = Math.round((weight / 10) * 3 * 100) / 100
      const record = (dim: UXDimension) => {
        dimensionScores[dim] = Math.max(
          0,
          Math.round((dimensionScores[dim] - deduction) * 100) / 100
        )
        evidenceByDimension[dim].push(`${fp.title} (${fp.severity})`)
      }

      record('efficiency')
      if (fp.severity === 'critical') record('learnability')
      if (fp.category === 'form_design') record('efficiency')
      if (fp.category === 'navigation') record('learnability')
      if (fp.category === 'content_clarity') record('memorability')
      if (this._isAccessibilityRelated(fp)) {
        record('accessibility')
        accessibilityIssues.push(this._buildAccessibilityIssue(fp))
      }
    }

    const dimensions: UsabilityDimensionScore[] = UX_DIMENSIONS.map((dim) => ({
      dimension: dim,
      score: dimensionScores[dim],
      rationale: this._dimensionRationale(dim, dimensionScores[dim], evidenceByDimension[dim]),
      evidence: evidenceByDimension[dim],
    }))

    // Weighted average — all six dimensions carry equal weight here.
    const overallScore =
      Math.round((dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length) * 10) / 10

    return {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      overallScore,
      dimensions,
      accessibilityIssues,
      heatmaps: [],
      calculatedAt: new Date(),
    }
  }

  private _dimensionRationale(dim: UXDimension, score: number, evidence: string[]): string {
    if (evidence.length === 0) {
      return `No observed friction affects "${dim}"; baseline 10.0 (not a measured claim).`
    }
    return `Reduced from baseline 10.0 to ${score.toFixed(1)} by ${evidence.length} observed friction(s): ${evidence.join('; ')}.`
  }

  private _isAccessibilityRelated(fp: FrictionPoint): boolean {
    const haystack = `${fp.category} ${fp.title} ${fp.description}`.toLowerCase()
    return (
      fp.category.toLowerCase().includes('accessibility') ||
      /accessib|wcag|contrast|keyboard|screen reader|aria/.test(haystack)
    )
  }

  private _buildAccessibilityIssue(fp: FrictionPoint): AccessibilityIssue {
    const text = `${fp.title} ${fp.description}`
    const wcagMatch = text.match(/\b\d(?:\.\d){1,2}\b/)
    return {
      id: crypto.randomUUID(),
      criterion: wcagMatch ? `WCAG ${wcagMatch[0]}` : 'WCAG 2.1 AA review',
      level: 'AA',
      description: `${fp.title}: ${fp.description}`,
      element: null,
      url: fp.url,
      remediation: fp.suggestedFix ?? 'Conduct a WCAG audit and remediate the reported friction.',
    }
  }

  private _buildTaskCompletionAnalysis(journey: UserJourney): TaskCompletionAnalysis {
    const steps = journey.steps ?? []
    const errorSteps = steps.filter((s) => s.status === 'error' || s.status === 'abandoned')
    const errorRates = steps
      .map((s) => s.errorRate)
      .filter((r): r is number => typeof r === 'number' && Number.isFinite(r))
    const avgErrorRate =
      errorRates.length > 0 ? errorRates.reduce((a, b) => a + b, 0) / errorRates.length : 0

    return {
      taskName: journey.name,
      completionRate: journey.completionRate ?? 0,
      averageTimeMs: journey.averageDurationMs,
      errorRate: Math.round(avgErrorRate * 1000) / 1000,
      criticalFailures: errorSteps.map((s) => s.name),
    }
  }

  private _generateRecommendations(
    workspaceId: WorkspaceId,
    projectId: string,
    frictionPoints: FrictionPoint[],
    journeys: UserJourney[]
  ): UXRecommendation[] {
    const recommendations: UXRecommendation[] = []

    // One recommendation per critical/high friction point.
    for (const fp of frictionPoints) {
      if (fp.severity !== 'critical' && fp.severity !== 'high') continue
      const interactionRelated = /interaction|navigation|click|form|input/.test(
        fp.category.toLowerCase()
      )
      recommendations.push(
        createUXRecommendation({
          workspaceId,
          projectId,
          type: interactionRelated ? 'fix_interaction' : 'reduce_friction',
          title: `Fix friction: ${fp.title}`,
          description: fp.description,
          rationale: `Friction point rated ${fp.severity} (category: ${fp.category}) blocks task completion.`,
          priority: fp.severity,
          effort: fp.estimatedImpact === 'high' ? 'high' : 'medium',
          expectedImpact: fp.suggestedFix
            ? `Applying the suggested fix ("${fp.suggestedFix}") removes the ${fp.severity} friction.`
            : `Removing this ${fp.severity} friction improves task completion and efficiency.`,
          relatedFrictionIds: [fp.id],
          relatedJourneyIds: fp.journeyId ? [fp.journeyId] : [],
          wcagCriteria: this._isAccessibilityRelated(fp) ? ['WCAG 2.1 AA'] : [],
        })
      )
    }

    // One optimize_flow recommendation per journey with completion < 0.5.
    for (const journey of journeys) {
      const rate = journey.completionRate
      if (rate === null || rate >= 0.5) continue
      recommendations.push(
        createUXRecommendation({
          workspaceId,
          projectId,
          type: 'optimize_flow',
          title: `Optimize flow: ${journey.name}`,
          description: `Journey "${journey.name}" completes at ${Math.round(rate * 100)}% — below the 50% threshold.`,
          rationale: 'Sub-50% completion indicates flow-level blockers across the journey steps.',
          priority: rate < 0.25 ? 'high' : 'medium',
          effort: 'medium',
          expectedImpact: 'Improving this journey lifts completion rate and reduces abandonment.',
          relatedFrictionIds: [],
          relatedJourneyIds: [journey.id],
          wcagCriteria: [],
        })
      )
    }

    return recommendations.sort((a, b) => {
      const rank: Record<UXRecommendation['priority'], number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      }
      return rank[a.priority] - rank[b.priority]
    })
  }
}
