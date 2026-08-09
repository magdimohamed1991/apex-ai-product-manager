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
  decisionAcceptanceRate: TrackedMetric
  outcomeSuccessRate: TrackedMetric
  unverifiableRate: TrackedMetric
  executionSuccessRate: TrackedMetric
  measuredDecisionLatencySeconds: TrackedMetric
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
}

export interface Action {
  id: string
  workspaceId: string
  title: string
  description: string
  target: string
  status: 'proposed' | 'approved' | 'queued' | 'in-progress' | 'completed' | 'failed'
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
  acceptanceRate: number
  totalOutcomes: number
  successCount: number
  successRate: number
  failedCount: number
  unverifiableRate: number
}
