/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback, useRef } from 'react'
import { apiClient, ApiError } from '../api/client'
import type {
  Workspace,
  Project,
  RepositoryConnection,
  Recommendation,
  ActivityEvent,
  Outcome,
  DecisionMetrics,
  LearningProfile,
  LearningSignal,
  ProductValidationMetrics,
  PriorityCalibration,
} from '../types'

const POLL_INTERVAL_MS = 5000

interface DashboardData {
  // Project state
  connection: RepositoryConnection | null
  setConnection: (c: RepositoryConnection) => void

  // Pipeline state
  recommendations: Recommendation[]
  approvedActions: Record<string, { id: string; status: string }>
  activityLog: ActivityEvent[]

  // Outcomes
  outcomes: Outcome[]
  decisionMetrics: DecisionMetrics | null

  // H4 reasoning
  reasoning: unknown | null
  isReasoningLoading: boolean
  fetchReasoning: (recId: string) => Promise<void>
  submitReasoningContext: (recId: string, projectContext: string) => Promise<void>

  // H6
  learningProfile: LearningProfile | null
  learningSignals: LearningSignal[]
  calibration: PriorityCalibration | null
  compileProfile: () => Promise<void>
  fetchCalibration: (recId: string) => Promise<void>

  // H7
  validationMetrics: ProductValidationMetrics | null

  // Actions
  approveAction: (recId: string, paId: string) => Promise<void>
  verifyOutcome: (outcomeId: string, filesAfterChange: Record<string, unknown>) => Promise<void>
  runAnalysis: () => Promise<void>

  // UI counts
  findingsCount: number
  executionsInProgress: number
}

export function useDashboardData(
  workspace: Workspace | null,
  project: Project | null,
  setGlobalError: (msg: string | null) => void
): DashboardData {
  const [connection, setConnection] = useState<RepositoryConnection | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [approvedActions, setApprovedActions] = useState<
    Record<string, { id: string; status: string }>
  >({})
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([])
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [decisionMetrics, setDecisionMetrics] = useState<DecisionMetrics | null>(null)
  const [learningProfile, setLearningProfile] = useState<LearningProfile | null>(null)
  const [learningSignals, setLearningSignals] = useState<LearningSignal[]>([])
  const [calibration, setCalibration] = useState<PriorityCalibration | null>(null)
  const [validationMetrics, setValidationMetrics] = useState<ProductValidationMetrics | null>(null)
  const [reasoning, setReasoning] = useState<unknown | null>(null)
  const [isReasoningLoading, setIsReasoningLoading] = useState(false)

  const aliveRef = useRef(true)

  function handleError(scope: string, err: unknown) {
    if (!aliveRef.current) return
    const message = err instanceof ApiError ? err.message : `${scope} failed`
    setGlobalError(message)
  }

  // Initial load
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!workspace || !project) {
      setConnection(null)
      setRecommendations([])
      setActivityLog([])
      setOutcomes([])
      setLearningProfile(null)
      setLearningSignals([])
      setCalibration(null)
      setValidationMetrics(null)
      setReasoning(null)
      return
    }
    void refreshAll()
    // refreshAll reads latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, project?.id])

  async function refreshAll() {
    if (!workspace || !project) return
    try {
      const [repo, recs, log, outs, dm, profile, signals, validation] = await Promise.all([
        apiClient.getRepository(workspace.id, project.id),
        apiClient.listRecommendations(workspace.id, project.id),
        apiClient.listActivity(workspace.id, project.id),
        apiClient.listOutcomes(workspace.id, project.id),
        apiClient.getDecisionMetrics(workspace.id, project.id),
        apiClient.getProfile(workspace.id, project.id),
        apiClient.getLearningSignals(workspace.id, project.id),
        apiClient.getProductValue(workspace.id, project.id),
      ])
      if (!aliveRef.current) return
      setConnection(repo && 'id' in repo ? repo : null)
      setRecommendations(recs)
      setActivityLog(log)
      setOutcomes(outs)
      setDecisionMetrics(dm)
      setLearningProfile(profile)
      setLearningSignals(signals)
      setValidationMetrics(validation)
    } catch (err) {
      handleError('load', err)
    }
  }

  // Lightweight polling for live updates
  useEffect(() => {
    if (!workspace || !project) return
    const id = setInterval(() => {
      void refreshAll()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
    // refreshAll is intentionally captured by closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, project?.id])

  const runAnalysis = useCallback(async () => {
    if (!workspace || !project) return
    try {
      await apiClient.runAnalysis(workspace.id, project.id)
      await refreshAll()
    } catch (err) {
      handleError('analysis', err)
    }
  }, [workspace, project])

  const approveAction = useCallback(
    async (recId: string, paId: string) => {
      if (!workspace || !project) return
      try {
        const action = await apiClient.approveAction(workspace.id, project.id, {
          recommendationId: recId,
          proposedActionId: paId,
        })
        setApprovedActions((prev) => ({
          ...prev,
          [action.id]: { id: action.id, status: action.status },
        }))
        try {
          await apiClient.createOutcome(workspace.id, project.id, recId, action.id)
        } catch {
          // outcome creation failure should not block approval
        }
        await refreshAll()
      } catch (err) {
        handleError('approve', err)
      }
    },
    [workspace, project]
  )

  const verifyOutcome = useCallback(
    async (outcomeId: string, filesAfterChange: Record<string, unknown>) => {
      if (!workspace) return
      try {
        await apiClient.verifyOutcome(workspace.id, outcomeId, filesAfterChange)
        await refreshAll()
      } catch (err) {
        handleError('verify', err)
      }
    },
    [workspace]
  )

  const fetchReasoning = useCallback(
    async (recId: string) => {
      if (!workspace) return
      setIsReasoningLoading(true)
      try {
        const r = await apiClient.getReasoning(workspace.id, recId)
        setReasoning(r)
      } catch (err) {
        handleError('reasoning', err)
      } finally {
        setIsReasoningLoading(false)
      }
    },
    [workspace]
  )

  const submitReasoningContext = useCallback(
    async (recId: string, projectContext: string) => {
      if (!workspace) return
      setIsReasoningLoading(true)
      try {
        const r = await apiClient.submitContext(workspace.id, recId, projectContext)
        setReasoning(r)
      } catch (err) {
        handleError('reasoning', err)
      } finally {
        setIsReasoningLoading(false)
      }
    },
    [workspace]
  )

  const compileProfile = useCallback(async () => {
    if (!workspace || !project) return
    try {
      await apiClient.compileProfile(workspace.id, project.id)
      await refreshAll()
    } catch (err) {
      handleError('compile-profile', err)
    }
  }, [workspace, project])

  const fetchCalibration = useCallback(
    async (recId: string) => {
      if (!workspace || !project) return
      try {
        const c = await apiClient.getCalibration(workspace.id, project.id, recId)
        setCalibration(c)
      } catch (err) {
        handleError('calibration', err)
      }
    },
    [workspace, project]
  )

  const findingsCount = recommendations.filter(
    (r) => r.priority === 'critical' || r.priority === 'high'
  ).length
  const executionsInProgress = activityLog.filter(
    (e) => e.type === 'execution' && /in-progress|queued/i.test(e.title)
  ).length

  return {
    connection,
    setConnection,
    recommendations,
    approvedActions,
    activityLog,
    outcomes,
    decisionMetrics,
    reasoning,
    isReasoningLoading,
    fetchReasoning,
    submitReasoningContext,
    learningProfile,
    learningSignals,
    calibration,
    compileProfile,
    fetchCalibration,
    validationMetrics,
    approveAction,
    verifyOutcome,
    runAnalysis,
    findingsCount,
    executionsInProgress,
  }
}
