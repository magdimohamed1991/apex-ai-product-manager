import type { WorkspaceId, Priority } from '../value-objects'

export type EffortLevel = 'low' | 'medium' | 'high'

export type RecommendationOrigin = 'insight' | 'finding'

/**
 * Typed recommendation category used by H6 adaptive learning.
 * Strategies MUST populate this field so category-level learning
 * is based on declared metadata, not brittle title-substring matching.
 */
export type RecommendationCategory = 'TESTING' | 'CI_CD' | 'TYPESCRIPT' | 'DOCKER'

export interface ProposedAction {
  id: string
  title: string
  description: string
}

export interface Recommendation {
  id: string
  workspaceId: WorkspaceId
  origin: RecommendationOrigin
  deduplicationKey: string // strategy:origin:sourceEntityId — used to detect semantic duplicates
  title: string
  rationale: string
  impact: string
  effort: EffortLevel
  priority: Priority
  confidence: number // 0–1
  insightIds: string[]
  findingIds: string[]
  proposedActions: ProposedAction[]
  createdAt: Date
  /**
   * Typed category. Optional for backward compatibility with older
   * recommendation records but REQUIRED for any recommendation that
   * participates in H6 adaptive learning. Strategies are responsible
   * for populating this field on creation.
   */
  category?: RecommendationCategory
}

/**
 * Domain factory to safely construct a Recommendation and enforce invariants.
 */
export function createRecommendation(
  data: Omit<Recommendation, 'id' | 'createdAt'> & { id?: string; createdAt?: Date }
): Recommendation {
  // Validate origin-provenance invariants
  if (data.origin === 'insight') {
    if (!data.insightIds || data.insightIds.length === 0) {
      throw new Error('Insight origin requires insightIds')
    }
    if (data.findingIds && data.findingIds.length > 0) {
      throw new Error('Insight origin rejects findingIds')
    }
  } else if (data.origin === 'finding') {
    if (!data.findingIds || data.findingIds.length === 0) {
      throw new Error('Finding origin requires findingIds')
    }
    if (data.insightIds && data.insightIds.length > 0) {
      throw new Error('Finding origin rejects insightIds')
    }
  } else {
    throw new Error(`Invalid origin: ${data.origin}`)
  }

  // Validate confidence range [0, 1]
  if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
    throw new Error(`Confidence must be a number between 0 and 1, received: ${data.confidence}`)
  }

  return {
    id: data.id ?? crypto.randomUUID(),
    workspaceId: data.workspaceId,
    origin: data.origin,
    deduplicationKey: data.deduplicationKey,
    title: data.title,
    rationale: data.rationale,
    impact: data.impact,
    effort: data.effort,
    priority: data.priority,
    confidence: data.confidence,
    insightIds: data.insightIds || [],
    findingIds: data.findingIds || [],
    proposedActions: data.proposedActions || [],
    createdAt: data.createdAt ?? new Date(),
    category: data.category,
  }
}
