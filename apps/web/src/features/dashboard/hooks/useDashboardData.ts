import { useEffect, useState, useCallback, useRef } from 'react'
import { apiClient, ApiError } from '../api/client'
import type {
  Workspace,
  Project,
  RepositoryConnection,
  Recommendation,
  Finding,
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
  findings: Finding[]
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
  const [findings, setFindings] = useState<Finding[]>([])
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
  // Monotonic request sequence: responses from a stale (previous project /
  // workspace) request are discarded so a slow response can never overwrite
  // the state of the currently selected project.
  const requestSeqRef = useRef(0)

  const handleError = useCallback(
    (scope: string, err: unknown) => {
      if (!aliveRef.current) return
      const message = err instanceof ApiError ? err.message : `${scope} failed`
      setGlobalError(message)
    },
    [setGlobalError]
  )

  // Initial load
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refreshAll = useCallback(async () => {
    if (!workspace || !project) return
    const seq = ++requestSeqRef.current
    try {
      const [repo, recs, found, log, outs, dm, profile, signals, validation] = await Promise.all([
        apiClient.getRepository(workspace.id, project.id),
        apiClient.listRecommendations(workspace.id, project.id),
        apiClient.listFindings(workspace.id, project.id),
        apiClient.listActivity(workspace.id, project.id),
        apiClient.listOutcomes(workspace.id, project.id),
        apiClient.getDecisionMetrics(workspace.id, project.id),
        apiClient.getProfile(workspace.id, project.id),
        apiClient.getLearningSignals(workspace.id, project.id),
        apiClient.getProductValue(workspace.id, project.id),
      ])
      if (!aliveRef.current || seq !== requestSeqRef.current) return
      setConnection(repo && 'id' in repo ? repo : null)
      setRecommendations(recs)
      setFindings(found)
      setActivityLog(log)
      setOutcomes(outs)
      setDecisionMetrics(dm)
      setLearningProfile(profile)
      setLearningSignals(signals)
      setValidationMetrics(validation)
    } catch (err) {
      if (seq === requestSeqRef.current) {
        handleError('load', err)
      }
    }
  }, [workspace, project, handleError])

  useEffect(() => {
    if (!workspace || !project) {
      // Resetting derived dashboard state when the selection becomes empty
      // is an external-system sync (a blank selection must never show the
      // previous project's data). The suppression is scoped to this
      // reset-only block.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnection(null)
      setRecommendations([])
      setFindings([])
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
  }, [workspace, project, refreshAll])

  // Lightweight polling for live updates
  useEffect(() => {
    if (!workspace || !project) return
    const id = setInterval(() => {
      void refreshAll()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [workspace, project, refreshAll])

  const runAnalysis = useCallback(async () => {
    if (!workspace || !project) return
    try {
      await apiClient.runAnalysis(workspace.id, project.id)
      await refreshAll()
    } catch (err) {
      handleError('analysis', err)
    }
  }, [workspace, project, refreshAll, handleError])

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
    [workspace, project, refreshAll, handleError]
  )

  const verifyOutcome = useCallback(
    async (outcomeId: string, filesAfterChange: Record<string, unknown>) => {
      if (!workspace || !project) return
      try {
        await apiClient.verifyOutcome(workspace.id, project!.id, outcomeId, filesAfterChange)
        await refreshAll()
      } catch (err) {
        handleError('verify', err)
      }
    },
    [workspace, refreshAll, handleError]
  )

  const fetchReasoning = useCallback(
    async (recId: string) => {
      if (!workspace || !project) return
      setIsReasoningLoading(true)
      try {
        const r = await apiClient.getReasoning(workspace.id, project!.id, recId)
        setReasoning(r)
      } catch (err) {
        handleError('reasoning', err)
      } finally {
        setIsReasoningLoading(false)
      }
    },
    [workspace, handleError]
  )

  const submitReasoningContext = useCallback(
    async (recId: string, projectContext: string) => {
      if (!workspace || !project) return
      setIsReasoningLoading(true)
      try {
        const r = await apiClient.submitContext(workspace.id, project!.id, recId, projectContext)
        setReasoning(r)
      } catch (err) {
        handleError('reasoning', err)
      } finally {
        setIsReasoningLoading(false)
      }
    },
    [workspace, handleError]
  )

  const compileProfile = useCallback(async () => {
    if (!workspace || !project) return
    try {
      await apiClient.compileProfile(workspace.id, project.id)
      await refreshAll()
    } catch (err) {
      handleError('compile-profile', err)
    }
  }, [workspace, project, refreshAll, handleError])

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
    [workspace, project, handleError]
  )

  const findingsCount = findings.filter(
    (f) => f.priority === 'critical' || f.priority === 'high'
  ).length
  const executionsInProgress = activityLog.filter(
    (e) => e.type === 'execution' && /in-progress|queued/i.test(e.title)
  ).length

  return {
    connection,
    setConnection,
    recommendations,
    findings,
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
