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
}
