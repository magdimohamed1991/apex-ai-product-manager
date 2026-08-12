/**
 * Dashboard domain types — these mirror the API response shapes used by
 * the dashboard. Keep them explicit (no `any`).
 */

export interface Workspace {
  id: string
  name: string
  slug: string
}

export interface Project {
  id: string
  workspaceId: string
  name: string
}

export interface RepositoryConnection {
  id: string
  workspaceId: string
  projectId: string
  provider: 'github'
  owner: string
  repository: string
  defaultBranch: string
  status: 'connected' | 'error'
}

export type OutcomeStatus =
  'PENDING' | 'VERIFIED_SUCCESS' | 'PARTIALLY_SUCCESSFUL' | 'FAILED' | 'NOT_VERIFIABLE' | 'REVERTED'

export interface Outcome {
  id: string
  recommendationId: string
  workspaceId: string
  projectId: string
  actionId: string | null
  executionId: string | null
  status: OutcomeStatus
  detectedAt: string
  resolvedAt: string | null
  verificationStatus: string
  verificationEvidence: string[]
  outcomeSummary: string
}

export type EpistemicState =
  'unavailable' | 'estimated' | 'observed' | 'derived' | 'validated' | 'insufficient_evidence'

export interface TrackedMetric {
  name: string
  value: number | null
  description: string
  source:
    'declared_assumption' | 'estimated_baseline' | 'empirical_observation' | 'derived_measurement'
  calculation: string
  observationCount: number
  confidence: 'low' | 'medium' | 'high' | 'insufficient_data'
  epistemicState: EpistemicState
}

export interface ProductValidationMetrics {
  workspaceId: string
  projectId: string
  generatedAt: string
  observationCount: number
  // PM Decision Metrics (PMDecisionTelemetry population only)
  decisionAcceptanceRate: TrackedMetric
  decisionRejectionRate: TrackedMetric
  decisionDeferRate: TrackedMetric
  decisionOverrideRate: TrackedMetric
  meanPriorityOverrideDelta: TrackedMetric
  measuredDecisionLatencySeconds: TrackedMetric
  // Outcome Metrics
  outcomeSuccessRate: TrackedMetric
  unverifiableRate: TrackedMetric
  // Execution Metrics
  executionSuccessRate: TrackedMetric
  confidence: {
    bucket: 'awaiting_pm_telemetry' | 'early_convergence' | 'high_within_apex_framework'
    rationale: string
  }
}

export interface ProposedAction {
  id: string
  title: string
  description: string
}

export interface Recommendation {
  id: string
  workspaceId: string
  origin: string
  title: string
  rationale: string
  impact: string
  effort: 'low' | 'medium' | 'high'
  priority: 'low' | 'medium' | 'high' | 'critical'
  confidence: number
  proposedActions: ProposedAction[]
  category?: string
  pmCategory?: string
  priorityScore?: number
  expectedOutcome?: string
  findingIds?: string[]
}

export interface Action {
  id: string
  workspaceId: string
  title: string
  description: string
  target: string
  status:
    | 'pending'
    | 'proposed'
    | 'approved'
    | 'queued'
    | 'in-progress'
    | 'completed'
    | 'failed'
    | 'blocked'
  relatedRecommendationId: string
  relatedProposedActionId: string
  externalId: string | null
}

export interface Finding {
  id: string
  workspaceId: string
  type: 'bug' | 'opportunity' | 'risk' | 'growth'
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  evidenceIds: string[]
  correlationId: string
  createdAt: string
}

export interface ActivityEvent {
  timestamp: string
  type: 'pipeline' | 'finding' | 'recommendation' | 'action' | 'execution'
  title: string
  description: string
  metadata?: Record<string, unknown>
}

export interface AIAlternative {
  label: string
  effort: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

export interface AIProductReasoning {
  recommendationId: string
  workspaceId: string
  model: string
  version: string
  contextHash: string
  rationale: string
  impactExplanation: string
  tradeoffs: string[]
  alternatives: AIAlternative[]
  knowns: string[]
  inferences: string[]
  unknowns: string[]
  clarifyingQuestions: string[]
  confidence: number
  recommendedDecision: string
  timestamp: string
  unavailable?: boolean
  failureReason?: 'provider_error' | 'invalid_json' | 'schema_violation' | 'grounding_violation'
}

export interface LearningSignal {
  id: string
  workspaceId: string
  projectId: string
  category: string
  type: string
  observationCount: number
  value: number
  confidence: number
  sourceRecommendationIds: string[]
  generatedAt: string
  evidenceState?: 'observed' | 'estimated' | 'insufficient_evidence'
  calibrationVersion?: string
}

export interface CategoryCoefficient {
  category: string
  adoptionRate: number
  executionSuccessRate: number
  outcomeVerifiedRate: number
  pmCalibrationWeight: number
}

export interface LearningProfile {
  workspaceId: string
  projectId: string
  totalDecisionsObserved: number
  lastCalculatedAt: string
  PMPreferences: {
    favoredCategories: string[]
    ignoredCategories: string[]
  }
  categoryCoefficients: CategoryCoefficient[]
  biasAdjustments: {
    overPrioritizedLowEffort: boolean
    favoredHighImpact: boolean
  }
  calibrationVersion?: string
}

export interface PriorityCalibration {
  baseScore: number
  calibratedScore: number
  preferenceMultiplier: number
  outcomeReliabilityMultiplier: number
  appliedSignals: LearningSignal[]
  explanation: string
  safetyFloorEnforced?: boolean
  calibrationVersion?: string
}

export interface DecisionTelemetryRecord {
  id: string
  workspaceId: string
  projectId: string
  recommendationId: string
  category?: string
  recommendationPresentedAt: string
  decisionStartedAt: string
  decisionCompletedAt: string
  decision: 'ACCEPT' | 'REJECT' | 'DEFER' | 'OVERRIDE'
  pmSelectedPriority?: number
  calibratedH6Score: number
  originalH3Score: number
  overrideOccurred: boolean
  overrideDelta?: number
  rankDisplacement?: number
  recordedAt: string
}

export interface DecisionMetrics {
  totalRecommendations: number
  totalApproved: number
  // PM Decision telemetry population (ACCEPT / total decisions)
  decisionCount: number
  acceptCount: number
  rejectCount: number
  deferCount: number
  overrideCount: number
  acceptanceRate: number
  totalOutcomes: number
  successCount: number
  successRate: number
  failedCount: number
  unverifiableRate: number
}

/**
 * H8-ACTION-8: Project dashboard stats — aggregated from persisted data.
 */
export interface ProjectStats {
  project: {
    id: string
    name: string
    status: string
    latestAnalysis: {
      status: string
      startedAt: string
      completedAt: string | null
      error: string | null
    } | null
  }
  recommendations: {
    total: number
    byPriority: { critical: number; high: number; medium: number; low: number }
  }
  decisions: {
    accept: number
    reject: number
    defer: number
    override: number
  }
  execution: {
    pending: number
    approved: number
    queued: number
    'in-progress': number
    completed: number
    failed: number
  }
  outcomes: {
    total: number
    verified: number
    failed: number
    pending: number
  }
  learning: {
    profileStatus: string
    totalDecisionsObserved: number
    signalCount: number
    evidenceState: string
    favoredCategories: string[]
    ignoredCategories: string[]
  }
}

/**
 * H8-ACTION-5: Execution lifecycle states.
 */
export type ExecutionLifecycleState =
  'pending' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'verified' | 'blocked'

/**
 * H8-ACTION-3: PM decision options for recommendation review.
 */
export type PMDecision = 'ACCEPT' | 'ACCEPT_EXECUTE' | 'REJECT' | 'DEFER' | 'OVERRIDE'

// ---------------------------------------------------------------------------
// H9 Competitor Intelligence
// ---------------------------------------------------------------------------

export type CompetitorTier = 'direct' | 'indirect' | 'aspirational' | 'emerging'

export interface CompetitorFeature {
  name: string
  description?: string
  maturity?: 'alpha' | 'beta' | 'ga' | 'unknown'
  link?: string | null
}

export interface CompetitorStrengthWeakness {
  dimension: string
  polarity: 'strength' | 'weakness'
  note?: string | null
}

export interface CompetitorPricing {
  model: 'free' | 'freemium' | 'per_seat' | 'usage_based' | 'enterprise' | 'unknown'
  entryPrice: number | null
  tiers: { name: string; price: number | null }[]
  note?: string | null
}

export interface Competitor {
  id: string
  workspaceId: string
  projectId: string
  name: string
  slug: string
  tier: CompetitorTier
  websiteUrl: string
  description: string | null
  tagline: string | null
  features: CompetitorFeature[]
  pricing: CompetitorPricing | null
  strengthsWeaknesses: CompetitorStrengthWeakness[]
  dataSource: 'crawled' | 'manual' | 'api'
  discoveredAt: string
  updatedAt: string
}

export type FeatureMatrixCellValue = 'yes' | 'no' | 'partial'

export interface FeatureMatrixCell {
  competitorId: string
  featureId: string
  value: FeatureMatrixCellValue
  note: string | null
}

export interface FeatureMatrix {
  id: string
  workspaceId: string
  projectId: string
  features: string[]
  cells: FeatureMatrixCell[]
  generatedAt: string
}

export interface PositioningDimension {
  name: string
  yourScore: number
  competitorScores: Record<string, number>
  source: 'baseline_assumption' | 'measured'
}

export interface PositioningMatrix {
  id: string
  workspaceId: string
  projectId: string
  dimensions: PositioningDimension[]
  generatedAt: string
}

export interface DifferentiationFactor {
  factor: string
  yourStrength: string
  competitorStrength: Record<string, string>
  significance: 'low' | 'medium' | 'high'
}

export interface DifferentiationAnalysis {
  id: string
  workspaceId: string
  projectId: string
  factors: DifferentiationFactor[]
  uniqueAdvantages: string[]
  uniqueDisadvantages: string[]
  generatedAt: string
}

export interface CompetitorGap {
  id: string
  featureName: string
  description: string
  competitorsWithFeature: string[]
  significance: 'low' | 'medium' | 'high' | 'critical'
  estimatedEffort: 'low' | 'medium' | 'high'
}

export interface MarketOpportunity {
  id: string
  workspaceId: string
  projectId: string
  title: string
  description: string
  opportunityScore: number
  gaps: CompetitorGap[]
  addressableCompetitors: string[]
  rationale: string
  generatedAt: string
}

export type CompetitorRecommendationType =
  | 'close_gap'
  | 'leverage_strength'
  | 'pricing_adjustment'
  | 'positioning_shift'
  | 'feature_parity'
  | 'differentiation'

export interface CompetitorRecommendation {
  id: string
  workspaceId: string
  projectId: string
  type: CompetitorRecommendationType
  title: string
  description: string
  rationale: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  effort: 'low' | 'medium' | 'high'
  opportunityScore: number
  relatedCompetitorIds: string[]
  relatedGapIds: string[]
  createdAt: string
}

export interface CompetitorAnalysis {
  id: string
  workspaceId: string
  projectId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  competitors: Competitor[]
  featureMatrix: FeatureMatrix | null
  positioningMatrix: PositioningMatrix | null
  differentiationAnalysis: DifferentiationAnalysis | null
  opportunities: MarketOpportunity[]
  recommendations: CompetitorRecommendation[]
  startedAt: string
  completedAt: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// H10 UX Intelligence
// ---------------------------------------------------------------------------

export interface JourneyStep {
  name: string
  order: number
  description: string
  status: 'completed' | 'error' | 'abandoned' | 'pending'
  errorRate: number | null
}

export interface UserJourney {
  id: string
  workspaceId: string
  projectId: string
  name: string
  description: string
  startUrl: string | null
  goalUrl: string | null
  steps: JourneyStep[]
  completionRate: number | null
  averageDurationMs: number | null
  navigationPattern: string | null
  dataSource: 'manual' | 'analytics' | 'crawl'
  createdAt: string
  analyzedAt: string | null
  updatedAt: string
}

export type FrictionSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface FrictionPoint {
  id: string
  workspaceId: string
  projectId: string
  journeyId: string | null
  stepId: string | null
  title: string
  description: string
  severity: FrictionSeverity
  category: string
  url: string | null
  evidence: string[]
  suggestedFix: string | null
  estimatedImpact: 'low' | 'medium' | 'high'
  detectedAt: string
}

export interface AccessibilityIssue {
  id: string
  criterion: string
  level: string
  description: string
  element: string | null
  url: string | null
  remediation: string
}

export interface InteractionEvent {
  element: string
  eventType: 'click' | 'scroll' | 'focus' | 'blur' | 'submit' | 'input'
  count: number
  averageDurationMs: number | null
}

export interface InteractionAnalysis {
  id: string
  workspaceId: string
  projectId: string
  url: string | null
  events: InteractionEvent[]
  topInteractions: string[]
  deadClicks: string[]
  rageClicks: string[]
  analyzedAt: string
}

export interface UsabilityDimensionScore {
  dimension: string
  score: number
  rationale: string
  evidence: string[]
}

export interface UsabilityScore {
  id: string
  workspaceId: string
  projectId: string
  overallScore: number
  dimensions: UsabilityDimensionScore[]
  accessibilityIssues: AccessibilityIssue[]
  heatmaps: unknown[]
  calculatedAt: string
}

export interface TaskCompletionAnalysis {
  taskName: string
  completionRate: number
  averageTimeMs: number | null
  errorRate: number
  criticalFailures: string[]
}

export type UXRecommendationType =
  | 'reduce_friction'
  | 'simplify_navigation'
  | 'improve_accessibility'
  | 'clarify_content'
  | 'optimize_flow'
  | 'fix_interaction'
  | 'improve_feedback'

export interface UXRecommendation {
  id: string
  workspaceId: string
  projectId: string
  type: UXRecommendationType
  title: string
  description: string
  rationale: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  effort: 'low' | 'medium' | 'high'
  expectedImpact: string
  relatedFrictionIds: string[]
  relatedJourneyIds: string[]
  wcagCriteria: string[]
  createdAt: string
}

export interface UXAnalysis {
  id: string
  workspaceId: string
  projectId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  journeys: UserJourney[]
  frictionPoints: FrictionPoint[]
  interactionAnalysis: InteractionAnalysis | null
  usabilityScore: UsabilityScore | null
  taskCompletionAnalyses: TaskCompletionAnalysis[]
  overallUXScore: number | null
  startedAt: string
  completedAt: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// H11 Browser Intelligence
// ---------------------------------------------------------------------------

export type CrawlPageType =
  | 'homepage'
  | 'pricing'
  | 'features'
  | 'documentation'
  | 'changelog'
  | 'blog'
  | 'about'
  | 'api_reference'
  | 'other'

export interface CrawlJobTarget {
  url: string
  pageType: CrawlPageType
  followLinks: boolean
  maxDepth: number
}

export interface RobotsPolicy {
  url: string
  allowed: boolean
  crawlDelaySeconds: number | null
  checkedAt: string
}

export interface ExtractedData {
  type: string
  content: Record<string, unknown>
  confidence: number
  extractedAt: string
}

export interface CrawlRateLimitState {
  domain: string
  requestsPerMinute: number
  lastRequestAt: string | null
  backoffUntil: string | null
  consecutiveErrors: number
}

export interface CrawledPage {
  id: string
  workspaceId: string
  projectId: string
  jobId: string
  url: string
  pageType: CrawlPageType
  title: string | null
  statusCode: number
  contentHash: string
  extractedData: ExtractedData[]
  snapshotRef: string | null
  robotsPolicy: RobotsPolicy
  changedAt: string | null
  error: string | null
  crawledAt: string
}

export type CrawlJobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'rate_limited' | 'robots_blocked'

export interface CrawlJob {
  id: string
  workspaceId: string
  projectId: string
  origin: 'user' | 'scheduled' | 'competitor_analysis' | 'ux_analysis'
  targets: CrawlJobTarget[]
  status: CrawlJobStatus
  pagesDiscovered: number
  pagesCrawled: number
  pagesSkipped: number
  pagesErrored: number
  rateLimitStates: CrawlRateLimitState[]
  respectRobots: boolean
  startedAt: string
  completedAt: string | null
  error: string | null
  nextScheduledAt: string | null
}

export interface BrowserIntelligenceSession {
  id: string
  workspaceId: string
  projectId: string
  seedUrls: string[]
  crawlJobIds: string[]
  totalPagesCrawled: number
  totalDataPoints: number
  lastIncrementalUpdateAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// H12 Executive Intelligence
// ---------------------------------------------------------------------------

export type ReportPeriod = 'weekly' | 'monthly' | 'quarterly'
export type ReportFormat = 'pdf' | 'markdown' | 'json'
export type TrendDirection = 'improving' | 'degrading' | 'stable' | 'volatile'
export type ProductHealthStatus = 'healthy' | 'at_risk' | 'critical' | 'unknown'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ExecutiveKPI {
  name: string
  value: number | null
  unit: string
  trend: TrendDirection
  previousValue: number | null
  periodLabel: string
  source: string
  epistemicNote: string
}

export interface ProductHealthSnapshot {
  id: string
  workspaceId: string
  projectId: string
  status: ProductHealthStatus
  overallScore: number | null
  kpis: ExecutiveKPI[]
  openCriticalFindings: number
  openHighFindings: number
  pendingRecommendations: number
  acceptedRecommendations: number
  outcomeSuccessRate: number | null
  decisionLatencySeconds: number | null
  pmAcceptanceRate: number | null
  competitorGapsCount: number
  uxFrictionScore: number | null
  snapshotAt: string
}

export interface TrendDataPoint {
  label: string
  value: number
}

export interface TrendDetection {
  id: string
  workspaceId: string
  projectId: string
  metricName: string
  direction: TrendDirection
  magnitude: number
  percentageChange: number | null
  dataPoints: TrendDataPoint[]
  periodStart: string
  periodEnd: string
  significance: 'low' | 'medium' | 'high'
  interpretation: string
  detectedAt: string
}

export interface MarketEvolutionSignal {
  id: string
  signalType: 'competitor_feature_added' | 'pricing_change' | 'new_entrant' | 'category_shift'
  title: string
  description: string
  sourceCompetitorId: string | null
  detectedAt: string
  significance: 'low' | 'medium' | 'high'
}

export interface InvestmentOpportunity {
  id: string
  title: string
  description: string
  estimatedROI: string
  confidence: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  rationale: string
  evidenceSources: string[]
  priority: 'low' | 'medium' | 'high' | 'critical'
}

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

export interface ExecutiveDashboard {
  id: string
  workspaceId: string
  projectId: string
  healthSnapshot: ProductHealthSnapshot | null
  trends: TrendDetection[]
  marketSignals: MarketEvolutionSignal[]
  investmentOpportunities: InvestmentOpportunity[]
  riskForecasts: RiskForecast[]
  roadmapInsights: string[]
  generatedAt: string
}

export interface ReportSection {
  title: string
  content: string
  order: number
}

export interface ExecutiveReport {
  id: string
  workspaceId: string
  projectId: string
  period: ReportPeriod
  periodStart: string
  periodEnd: string
  title: string
  executiveSummary: string
  sections: ReportSection[]
  kpis: ExecutiveKPI[]
  trends: TrendDetection[]
  investmentOpportunities: InvestmentOpportunity[]
  riskForecasts: RiskForecast[]
  markdownExport: string | null
  jsonExport: string | null
  generatedAt: string
  exportedAt: string | null
}
