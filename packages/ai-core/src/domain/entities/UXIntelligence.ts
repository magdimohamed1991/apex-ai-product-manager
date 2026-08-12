/**
 * UXIntelligence domain entities (H10)
 *
 * Models user journeys, friction points, usability scoring, heatmap
 * abstractions, interaction analysis, and UX recommendations. All
 * measurements are evidence-backed — no synthetic values.
 */
import type { WorkspaceId } from '../value-objects'

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type FrictionSeverity = 'low' | 'medium' | 'high' | 'critical'
export type JourneyStepStatus = 'completed' | 'abandoned' | 'error' | 'skipped'
export type AccessibilityIssueLevel = 'A' | 'AA' | 'AAA'
export type NavigationPattern =
  'linear' | 'hub_and_spoke' | 'branching' | 'search_dominant' | 'back_tracking'
export type UXDimension =
  | 'learnability'
  | 'efficiency'
  | 'memorability'
  | 'error_prevention'
  | 'satisfaction'
  | 'accessibility'

// ---------------------------------------------------------------------------
// User journey
// ---------------------------------------------------------------------------

export interface JourneyStep {
  id: string
  order: number
  name: string
  description: string
  expectedDurationMs: number | null
  observedDurationMs: number | null
  status: JourneyStepStatus
  dropOffRate: number | null // 0–1
  errorRate: number | null // 0–1
  interactions: string[]
}

export interface UserJourney {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  name: string
  description: string
  startUrl: string | null
  goalUrl: string | null
  steps: JourneyStep[]
  completionRate: number | null // 0–1; null = not enough data
  averageDurationMs: number | null
  navigationPattern: NavigationPattern | null
  dataSource: 'manual' | 'crawled' | 'analytics_import'
  analyzedAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Friction points
// ---------------------------------------------------------------------------

export interface FrictionPoint {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  journeyId: string | null
  stepId: string | null
  title: string
  description: string
  severity: FrictionSeverity
  category: string // e.g. "form_design", "navigation", "content_clarity"
  url: string | null
  evidence: string[] // screenshots, quotes, analytics references
  suggestedFix: string | null
  estimatedImpact: 'low' | 'medium' | 'high'
  detectedAt: Date
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

export interface AccessibilityIssue {
  id: string
  criterion: string // WCAG criterion number, e.g. "1.4.3"
  level: AccessibilityIssueLevel
  description: string
  element: string | null // CSS selector or description
  url: string | null
  remediation: string
}

// ---------------------------------------------------------------------------
// Heatmap abstraction
// ---------------------------------------------------------------------------

export interface HeatmapZone {
  label: string
  x: number // normalised 0–1
  y: number // normalised 0–1
  width: number
  height: number
  intensity: number // 0–1
  interactionType: 'click' | 'scroll' | 'hover' | 'rage_click'
}

export interface HeatmapAbstraction {
  id: string
  url: string
  zones: HeatmapZone[]
  capturedAt: Date | null
  deviceType: 'desktop' | 'mobile' | 'tablet'
}

// ---------------------------------------------------------------------------
// Interaction analysis
// ---------------------------------------------------------------------------

export interface InteractionEvent {
  element: string
  eventType: 'click' | 'scroll' | 'focus' | 'blur' | 'submit' | 'input'
  count: number
  averageDurationMs: number | null
}

export interface InteractionAnalysis {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  url: string | null
  events: InteractionEvent[]
  topInteractions: string[]
  deadClicks: string[] // elements users click that have no action
  rageClicks: string[] // elements with frustrated repeated clicks
  analyzedAt: Date
}

// ---------------------------------------------------------------------------
// Usability scoring (Nielsen's 10 heuristics-inspired)
// ---------------------------------------------------------------------------

export interface UsabilityDimensionScore {
  dimension: UXDimension
  score: number // 0–10
  rationale: string
  evidence: string[]
}

export interface UsabilityScore {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  overallScore: number // 0–10; weighted average
  dimensions: UsabilityDimensionScore[]
  accessibilityIssues: AccessibilityIssue[]
  heatmaps: HeatmapAbstraction[]
  calculatedAt: Date
}

// ---------------------------------------------------------------------------
// UX analysis session (aggregate)
// ---------------------------------------------------------------------------

export interface TaskCompletionAnalysis {
  taskName: string
  completionRate: number // 0–1
  averageTimeMs: number | null
  errorRate: number // 0–1
  criticalFailures: string[]
}

export interface UXAnalysis {
  id: string
  workspaceId: WorkspaceId
  projectId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  journeys: UserJourney[]
  frictionPoints: FrictionPoint[]
  interactionAnalysis: InteractionAnalysis | null
  usabilityScore: UsabilityScore | null
  taskCompletionAnalyses: TaskCompletionAnalysis[]
  overallUXScore: number | null // 0–100
  startedAt: Date
  completedAt: Date | null
  error: string | null
}

// ---------------------------------------------------------------------------
// UX recommendations
// ---------------------------------------------------------------------------

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
  workspaceId: WorkspaceId
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
  wcagCriteria: string[] // empty unless accessibility-related
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Validators & factories
// ---------------------------------------------------------------------------

export function validateUXAnalysis(a: UXAnalysis): void {
  if (!a.id || !a.id.trim()) throw new Error('UXAnalysis must have a valid id')
  if (!a.workspaceId || !a.workspaceId.trim()) throw new Error('UXAnalysis must have a workspaceId')
  if (!a.projectId || !a.projectId.trim()) throw new Error('UXAnalysis must have a projectId')
}

export function createUXAnalysis(
  data: Omit<UXAnalysis, 'id' | 'startedAt'> & { id?: string; startedAt?: Date }
): UXAnalysis {
  const a: UXAnalysis = {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    status: data.status,
    journeys: data.journeys ?? [],
    frictionPoints: data.frictionPoints ?? [],
    interactionAnalysis: data.interactionAnalysis ?? null,
    usabilityScore: data.usabilityScore ?? null,
    taskCompletionAnalyses: data.taskCompletionAnalyses ?? [],
    overallUXScore: data.overallUXScore ?? null,
    startedAt: data.startedAt ?? new Date(),
    completedAt: data.completedAt ?? null,
    error: data.error ?? null,
  }
  validateUXAnalysis(a)
  return a
}

export function createUserJourney(
  data: Omit<UserJourney, 'id' | 'analyzedAt' | 'updatedAt'> & {
    id?: string
    analyzedAt?: Date
    updatedAt?: Date
  }
): UserJourney {
  if (!data.name || !data.name.trim()) throw new Error('UserJourney must have a name')
  if (!data.workspaceId || !data.workspaceId.trim())
    throw new Error('UserJourney must have a workspaceId')
  if (!data.projectId || !data.projectId.trim())
    throw new Error('UserJourney must have a projectId')
  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    name: data.name,
    description: data.description,
    startUrl: data.startUrl ?? null,
    goalUrl: data.goalUrl ?? null,
    steps: data.steps ?? [],
    completionRate: data.completionRate ?? null,
    averageDurationMs: data.averageDurationMs ?? null,
    navigationPattern: data.navigationPattern ?? null,
    dataSource: data.dataSource,
    analyzedAt: data.analyzedAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  }
}

export function createFrictionPoint(
  data: Omit<FrictionPoint, 'id' | 'detectedAt'> & { id?: string; detectedAt?: Date }
): FrictionPoint {
  if (!data.title || !data.title.trim()) throw new Error('FrictionPoint must have a title')
  if (!data.workspaceId || !data.workspaceId.trim())
    throw new Error('FrictionPoint must have a workspaceId')
  if (!data.projectId || !data.projectId.trim())
    throw new Error('FrictionPoint must have a projectId')
  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    journeyId: data.journeyId ?? null,
    stepId: data.stepId ?? null,
    title: data.title,
    description: data.description,
    severity: data.severity,
    category: data.category,
    url: data.url ?? null,
    evidence: data.evidence ?? [],
    suggestedFix: data.suggestedFix ?? null,
    estimatedImpact: data.estimatedImpact,
    detectedAt: data.detectedAt ?? new Date(),
  }
}

export function createUXRecommendation(
  data: Omit<UXRecommendation, 'id' | 'createdAt'> & { id?: string; createdAt?: Date }
): UXRecommendation {
  if (!data.title || !data.title.trim()) throw new Error('UXRecommendation must have a title')
  if (!data.workspaceId || !data.workspaceId.trim())
    throw new Error('UXRecommendation must have a workspaceId')
  if (!data.projectId || !data.projectId.trim())
    throw new Error('UXRecommendation must have a projectId')
  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    type: data.type,
    title: data.title,
    description: data.description,
    rationale: data.rationale,
    priority: data.priority,
    effort: data.effort,
    expectedImpact: data.expectedImpact,
    relatedFrictionIds: data.relatedFrictionIds ?? [],
    relatedJourneyIds: data.relatedJourneyIds ?? [],
    wcagCriteria: data.wcagCriteria ?? [],
    createdAt: data.createdAt ?? new Date(),
  }
}
