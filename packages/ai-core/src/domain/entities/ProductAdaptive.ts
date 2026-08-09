import type { WorkspaceId } from '../value-objects'

export interface LearningSignal {
  id: string
  workspaceId: WorkspaceId
  projectId: string

  category: string
  type: 'ADOPTION' | 'EXECUTION_SUCCESS' | 'OUTCOME_SUCCESS' | 'REJECTION' | 'IGNORED' | 'CALIBRATION'

  observationCount: number
  value: number // Rate or multiplier value, e.g. 0.85
  confidence: number // Statistical confidence weight from 0.0 to 1.0

  sourceRecommendationIds: string[]
  generatedAt: Date
}

export interface CategoryCoefficient {
  category: string
  adoptionRate: number
  executionSuccessRate: number
  outcomeVerifiedRate: number
  pmCalibrationWeight: number
}

export interface AdaptiveLearningProfile {
  workspaceId: WorkspaceId
  projectId: string
  totalDecisionsObserved: number
  lastCalculatedAt: Date

  PMPreferences: {
    favoredCategories: string[]
    ignoredCategories: string[]
  }

  categoryCoefficients: CategoryCoefficient[]

  biasAdjustments: {
    overPrioritizedLowEffort: boolean
    favoredHighImpact: boolean
  }
}

export interface PriorityCalibration {
  baseScore: number
  calibratedScore: number

  preferenceMultiplier: number
  outcomeReliabilityMultiplier: number

  appliedSignals: LearningSignal[]

  explanation: string
}

export interface VerificationEvidence {
  hasVitestConfig?: boolean
  hasJestConfig?: boolean
  hasJest?: boolean
  hasGitHubActions?: boolean
  hasCI?: boolean
  hasTypeScriptConfig?: boolean
  [key: string]: any
}
