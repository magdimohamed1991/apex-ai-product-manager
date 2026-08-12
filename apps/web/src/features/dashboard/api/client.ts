/**
 * Dashboard API client (Milestone I - Production Hardening)
 *
 * Thin wrapper around `fetch` that:
 *   - always includes the session Bearer token
 *   - parses JSON responses
 *   - surfaces typed errors from the safe error envelope
 *   - sets a default timeout
 *
 * All dashboard data access is funneled through this module so the
 * page component itself does not need to know HTTP details.
 */

import type {
  Workspace,
  Project,
  RepositoryConnection,
  Recommendation,
  Finding,
  DecisionTelemetryRecord,
  Action,
  ActivityEvent,
  AIProductReasoning,
  Outcome,
  DecisionMetrics,
  LearningProfile,
  LearningSignal,
  PriorityCalibration,
  ProductValidationMetrics,
  ProjectStats,
  Competitor,
  CompetitorAnalysis,
  CompetitorRecommendation,
  FeatureMatrix,
  PositioningMatrix,
  DifferentiationAnalysis,
  MarketOpportunity,
  UserJourney,
  FrictionPoint,
  UXAnalysis,
  UXRecommendation,
  CrawlJob,
  CrawlJobTarget,
  CrawledPage,
  BrowserIntelligenceSession,
  ExecutiveDashboard,
  ExecutiveReport,
  ProductHealthSnapshot,
  TrendDetection,
  ReportPeriod,
  ReportFormat,
  ScheduledJob,
  JobExecution,
  JobMetrics,
} from '../types'

const DEFAULT_TIMEOUT_MS = 30000

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) {
      const envelope = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string }
      }
      const code = envelope?.error?.code || 'UNKNOWN_ERROR'
      const message = envelope?.error?.message || res.statusText || 'Request failed'
      throw new ApiError(code, message, res.status)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export const apiClient = {
  get<T>(path: string) {
    return call<T>('GET', path)
  },
  post<T>(path: string, body: unknown) {
    return call<T>('POST', path, body)
  },
  patch<T>(path: string, body: unknown) {
    return call<T>('PATCH', path, body)
  },
  delete<T>(path: string) {
    return call<T>('DELETE', path)
  },
  // Domain helpers
  listWorkspaces: () => apiClient.get<Workspace[]>('/api/workspaces'),
  listProjects: (wsId: string) => apiClient.get<Project[]>(`/api/projects?workspaceId=${wsId}`),
  getRepository: (wsId: string, pId: string) =>
    apiClient.get<RepositoryConnection | { status: 'not_connected' }>(
      `/api/projects/${pId}/repository?workspaceId=${wsId}`
    ),
  connectRepository: (
    wsId: string,
    pId: string,
    body: { provider: string; owner: string; repository: string; defaultBranch: string }
  ) =>
    apiClient.post<RepositoryConnection>(`/api/projects/${pId}/repository`, {
      workspaceId: wsId,
      ...body,
    }),
  runAnalysis: (wsId: string, pId: string) =>
    apiClient.post<{ id: string; status: string; error: string | null }>(
      `/api/projects/${pId}/analysis`,
      { workspaceId: wsId }
    ),
  listRecommendations: (wsId: string, pId: string) =>
    apiClient.get<Recommendation[]>(`/api/projects/${pId}/recommendations?workspaceId=${wsId}`),
  listFindings: (wsId: string, pId: string) =>
    apiClient.get<Finding[]>(`/api/projects/${pId}/findings?workspaceId=${wsId}`),
  listActivity: (wsId: string, pId: string) =>
    apiClient.get<ActivityEvent[]>(`/api/projects/${pId}/activity?workspaceId=${wsId}`),
  listOutcomes: (wsId: string, pId: string) =>
    apiClient.get<Outcome[]>(`/api/projects/${pId}/outcomes?workspaceId=${wsId}`),
  getDecisionMetrics: (wsId: string, pId: string) =>
    apiClient.get<DecisionMetrics>(`/api/projects/${pId}/decision-metrics?workspaceId=${wsId}`),
  getReasoning: (wsId: string, pId: string, recId: string) =>
    apiClient.get<AIProductReasoning>(
      `/api/recommendations/${recId}/reasoning?workspaceId=${wsId}&projectId=${pId}`
    ),
  submitContext: (wsId: string, pId: string, recId: string, projectContext: string) =>
    apiClient.post<AIProductReasoning>(`/api/recommendations/${recId}/reasoning`, {
      workspaceId: wsId,
      projectId: pId,
      projectContext,
    }),
  approveAction: (
    wsId: string,
    pId: string,
    body: { recommendationId: string; proposedActionId: string }
  ) =>
    apiClient.post<Action>(`/api/actions/approve`, {
      workspaceId: wsId,
      projectId: pId,
      ...body,
    }),
  createOutcome: (wsId: string, pId: string, recId: string, actionId?: string) =>
    apiClient.post<Outcome>('/api/outcomes/create', {
      workspaceId: wsId,
      projectId: pId,
      recommendationId: recId,
      actionId,
    }),
  verifyOutcome: (
    wsId: string,
    pId: string,
    outcomeId: string,
    filesAfterChange: Record<string, unknown>
  ) =>
    apiClient.post<Outcome>('/api/outcomes/verify', {
      workspaceId: wsId,
      projectId: pId,
      outcomeId,
      filesAfterChange,
    }),
  getProfile: (wsId: string, pId: string) =>
    apiClient.get<LearningProfile | null>(`/api/projects/${pId}/profile?workspaceId=${wsId}`),
  getLearningSignals: (wsId: string, pId: string) =>
    apiClient.get<LearningSignal[]>(`/api/projects/${pId}/learning-signals?workspaceId=${wsId}`),
  getCalibration: (wsId: string, pId: string, recId: string) =>
    apiClient.get<PriorityCalibration>(
      `/api/recommendations/${recId}/calibration?workspaceId=${wsId}&projectId=${pId}`
    ),
  compileProfile: (wsId: string, pId: string) =>
    apiClient.post<LearningProfile>(`/api/projects/${pId}/compile-profile`, { workspaceId: wsId }),
  recordDecision: (
    wsId: string,
    pId: string,
    body: {
      recommendationId: string
      decision: 'ACCEPT' | 'REJECT' | 'DEFER' | 'OVERRIDE'
      decisionStartedAt: string
      decisionCompletedAt: string
      recommendationPresentedAt: string
      pmSelectedPriority?: number
      apexRank?: number
      pmRank?: number
    }
  ) =>
    apiClient.post<DecisionTelemetryRecord>(`/api/projects/${pId}/decision-telemetry`, {
      workspaceId: wsId,
      ...body,
    }),
  getProductValue: (wsId: string, pId: string) =>
    apiClient.get<ProductValidationMetrics>(
      `/api/projects/${pId}/product-value?workspaceId=${wsId}`
    ),
  getProjectStats: (wsId: string, pId: string) =>
    apiClient.get<ProjectStats>(`/api/projects/${pId}/stats?workspaceId=${wsId}`),
  getDecisionTelemetry: (wsId: string, pId: string) =>
    apiClient.get<DecisionTelemetryRecord[]>(`/api/projects/${pId}/telemetry?workspaceId=${wsId}`),

  // ------------------------------------------------------------------
  // H9 Competitor Intelligence
  // ------------------------------------------------------------------
  runCompetitorAnalysis: (wsId: string, pId: string) =>
    apiClient.post<CompetitorAnalysis>(`/api/projects/${pId}/competitor-analysis`, {
      workspaceId: wsId,
    }),
  getCompetitorAnalysis: (wsId: string, pId: string) =>
    apiClient.get<CompetitorAnalysis | null>(
      `/api/projects/${pId}/competitor-analysis?workspaceId=${wsId}`
    ),
  addCompetitor: (
    wsId: string,
    pId: string,
    body: {
      name: string
      slug: string
      tier: 'direct' | 'indirect' | 'aspirational' | 'emerging'
      websiteUrl: string
      description?: string | null
    }
  ) =>
    apiClient.post<Competitor>(`/api/projects/${pId}/competitors`, { workspaceId: wsId, ...body }),
  listCompetitors: (wsId: string, pId: string) =>
    apiClient.get<Competitor[]>(`/api/projects/${pId}/competitors?workspaceId=${wsId}`),
  getFeatureMatrix: (wsId: string, pId: string) =>
    apiClient.get<FeatureMatrix | null>(`/api/projects/${pId}/feature-matrix?workspaceId=${wsId}`),
  getPositioningMatrix: (wsId: string, pId: string) =>
    apiClient.get<PositioningMatrix | null>(
      `/api/projects/${pId}/positioning-matrix?workspaceId=${wsId}`
    ),
  getDifferentiation: (wsId: string, pId: string) =>
    apiClient.get<DifferentiationAnalysis | null>(
      `/api/projects/${pId}/differentiation?workspaceId=${wsId}`
    ),
  getMarketOpportunities: (wsId: string, pId: string) =>
    apiClient.get<MarketOpportunity[]>(
      `/api/projects/${pId}/market-opportunities?workspaceId=${wsId}`
    ),
  getCompetitorRecommendations: (wsId: string, pId: string) =>
    apiClient.get<CompetitorRecommendation[]>(
      `/api/projects/${pId}/competitor-recommendations?workspaceId=${wsId}`
    ),

  // ------------------------------------------------------------------
  // H10 UX Intelligence
  // ------------------------------------------------------------------
  runUXAnalysis: (wsId: string, pId: string) =>
    apiClient.post<UXAnalysis>(`/api/projects/${pId}/ux-analysis`, { workspaceId: wsId }),
  getUXAnalysis: (wsId: string, pId: string) =>
    apiClient.get<UXAnalysis | null>(`/api/projects/${pId}/ux-analysis?workspaceId=${wsId}`),
  addUserJourney: (
    wsId: string,
    pId: string,
    body: { name: string; description: string; completionRate?: number | null }
  ) =>
    apiClient.post<UserJourney>(`/api/projects/${pId}/user-journeys`, {
      workspaceId: wsId,
      ...body,
    }),
  listUserJourneys: (wsId: string, pId: string) =>
    apiClient.get<UserJourney[]>(`/api/projects/${pId}/user-journeys?workspaceId=${wsId}`),
  addFrictionPoint: (
    wsId: string,
    pId: string,
    body: {
      title: string
      description: string
      severity: 'critical' | 'high' | 'medium' | 'low'
      category: string
      suggestedFix?: string | null
      estimatedImpact?: 'low' | 'medium' | 'high'
    }
  ) =>
    apiClient.post<FrictionPoint>(`/api/projects/${pId}/friction-points`, {
      workspaceId: wsId,
      ...body,
    }),
  listFrictionPoints: (wsId: string, pId: string) =>
    apiClient.get<FrictionPoint[]>(`/api/projects/${pId}/friction-points?workspaceId=${wsId}`),
  getUXRecommendations: (wsId: string, pId: string) =>
    apiClient.get<UXRecommendation[]>(
      `/api/projects/${pId}/ux-recommendations?workspaceId=${wsId}`
    ),

  // ------------------------------------------------------------------
  // H11 Browser Intelligence
  // ------------------------------------------------------------------
  startCrawl: (
    wsId: string,
    pId: string,
    body: { targets: Pick<CrawlJobTarget, 'url' | 'pageType'>[]; origin?: string }
  ) => apiClient.post<CrawlJob>(`/api/projects/${pId}/crawl`, { workspaceId: wsId, ...body }),
  listCrawlJobs: (wsId: string, pId: string) =>
    apiClient.get<CrawlJob[]>(`/api/projects/${pId}/crawl-jobs?workspaceId=${wsId}`),
  listCrawledPages: (wsId: string, pId: string) =>
    apiClient.get<CrawledPage[]>(`/api/projects/${pId}/crawled-pages?workspaceId=${wsId}`),
  getBrowserSession: (wsId: string, pId: string) =>
    apiClient.get<BrowserIntelligenceSession | null>(
      `/api/projects/${pId}/browser-session?workspaceId=${wsId}`
    ),

  // ------------------------------------------------------------------
  // H12 Executive Intelligence
  // ------------------------------------------------------------------
  generateExecutiveDashboard: (wsId: string, pId: string) =>
    apiClient.post<ExecutiveDashboard>(`/api/projects/${pId}/executive-dashboard`, {
      workspaceId: wsId,
    }),
  getExecutiveDashboard: (wsId: string, pId: string) =>
    apiClient.get<{ dashboard: ExecutiveDashboard | null; snapshot: ProductHealthSnapshot | null }>(
      `/api/projects/${pId}/executive-dashboard?workspaceId=${wsId}`
    ),
  generateExecutiveReport: (wsId: string, pId: string, period: ReportPeriod) =>
    apiClient.post<ExecutiveReport>(`/api/projects/${pId}/executive-reports`, {
      workspaceId: wsId,
      period,
    }),
  listExecutiveReports: (wsId: string, pId: string) =>
    apiClient.get<ExecutiveReport[]>(`/api/projects/${pId}/executive-reports?workspaceId=${wsId}`),
  exportExecutiveReport: (wsId: string, pId: string, reportId: string, format: ReportFormat) =>
    apiClient.get<{ format: ReportFormat; content: string | null; note?: string }>(
      `/api/projects/${pId}/executive-reports/${reportId}/export?workspaceId=${wsId}&format=${format}`
    ),
  listTrends: (wsId: string, pId: string) =>
    apiClient.get<TrendDetection[]>(`/api/projects/${pId}/trends?workspaceId=${wsId}`),

  // V2.1 — Continuous Intelligence
  createScheduledJob: (
    wsId: string,
    pId: string,
    input: {
      name: string
      jobType: string
      schedule: {
        cronExpression: string | null
        intervalMs: number | null
        oneTimeAt: string | null
      }
      retryPolicy?: Record<string, unknown>
      maxConsecutiveFailures?: number
      config?: Record<string, unknown>
    }
  ) =>
    apiClient.post<ScheduledJob>(`/api/projects/${pId}/scheduled-jobs`, {
      workspaceId: wsId,
      ...input,
    }),
  listScheduledJobs: (wsId: string, pId: string) =>
    apiClient.get<ScheduledJob[]>(`/api/projects/${pId}/scheduled-jobs?workspaceId=${wsId}`),
  getScheduledJob: (wsId: string, pId: string, jobId: string) =>
    apiClient.get<ScheduledJob>(`/api/projects/${pId}/scheduled-jobs/${jobId}?workspaceId=${wsId}`),
  updateScheduledJob: (wsId: string, pId: string, jobId: string, input: Partial<ScheduledJob>) =>
    apiClient.patch<ScheduledJob>(`/api/projects/${pId}/scheduled-jobs/${jobId}`, {
      workspaceId: wsId,
      ...input,
    }),
  deleteScheduledJob: (wsId: string, pId: string, jobId: string) =>
    apiClient.delete<{ deleted: boolean }>(
      `/api/projects/${pId}/scheduled-jobs/${jobId}?workspaceId=${wsId}`
    ),
  triggerScheduledJob: (wsId: string, pId: string, jobId: string) =>
    apiClient.post<JobExecution>(`/api/projects/${pId}/scheduled-jobs/${jobId}/trigger`, {
      workspaceId: wsId,
    }),
  pauseScheduledJob: (wsId: string, pId: string, jobId: string) =>
    apiClient.post<ScheduledJob>(`/api/projects/${pId}/scheduled-jobs/${jobId}/pause`, {
      workspaceId: wsId,
    }),
  resumeScheduledJob: (wsId: string, pId: string, jobId: string) =>
    apiClient.post<ScheduledJob>(`/api/projects/${pId}/scheduled-jobs/${jobId}/resume`, {
      workspaceId: wsId,
    }),
  listScheduledExecutions: (wsId: string, pId: string, jobId: string) =>
    apiClient.get<JobExecution[]>(
      `/api/projects/${pId}/scheduled-jobs/${jobId}/executions?workspaceId=${wsId}`
    ),
  getScheduledJobMetrics: (wsId: string, pId: string, jobId: string) =>
    apiClient.get<JobMetrics>(
      `/api/projects/${pId}/scheduled-jobs/${jobId}/metrics?workspaceId=${wsId}`
    ),
  listDueScheduledJobs: (wsId: string, pId: string) =>
    apiClient.get<ScheduledJob[]>(`/api/projects/${pId}/scheduled-jobs/due?workspaceId=${wsId}`),
}
