import type { Evidence } from '@apex/analysis'
import type { Finding } from '../../domain/entities/Finding'
import type { Explanation } from '../../domain/entities/Explanation'
import type { WorkspaceId } from '../../domain/value-objects'
import type { CorrelationCandidate } from '../contracts/CorrelationCandidate'

export interface CorrelationFindingResult {
  finding: Finding
  explanation: Explanation
}

export interface BuilderValidationError {
  valid: false
  reason: string
}

export type BuilderResult = CorrelationFindingResult | BuilderValidationError

/**
 * Converts a validated CorrelationCandidate into a domain Finding + Explanation.
 *
 * Rules:
 * - A candidate with no evidence is rejected
 * - A candidate with score outside [0,1] is rejected
 * - Confidence is derived independently from correlation score
 * - Language never claims causation
 */
export class CorrelationFindingBuilder {
  build(
    candidate: CorrelationCandidate,
    evidence: Evidence[],
    workspaceId: WorkspaceId
  ): BuilderResult {
    // Validation
    const validationError = this.validate(candidate, evidence)
    if (validationError) return { valid: false, reason: validationError }

    const relatedEvidence = evidence.filter((e) => candidate.evidenceIds.includes(e.id))

    const confidence = this.deriveConfidence(candidate, relatedEvidence)
    const title = this.buildTitle(candidate)
    const description = this.buildDescription(candidate, relatedEvidence)

    const finding: Finding = {
      id: crypto.randomUUID(),
      workspaceId,
      type: this.inferFindingType(candidate),
      title,
      description,
      priority: this.inferPriority(candidate.score),
      severity: this.inferSeverity(candidate.score),
      relatedInsights: [],
      correlationId: candidate.id,
      createdAt: new Date(),
    }

    const explanation: Explanation = {
      id: crypto.randomUUID(),
      workspaceId,
      insightId: finding.id,
      summary: this.buildExplanationSummary(candidate, relatedEvidence),
      evidence: relatedEvidence.map((e) => `[${e.source}] ${e.key}: ${JSON.stringify(e.value)}`),
      appliedRules: [candidate.ruleId],
      confidenceReason: this.buildConfidenceReason(candidate, relatedEvidence, confidence),
      createdAt: new Date(),
    }

    return { finding, explanation }
  }

  private validate(candidate: CorrelationCandidate, evidence: Evidence[]): string | null {
    if (candidate.evidenceIds.length === 0) {
      return 'Candidate has no evidence IDs'
    }

    if (candidate.score < 0 || candidate.score > 1) {
      return `Candidate score ${candidate.score} is outside valid range [0, 1]`
    }

    const evidenceIds = new Set(evidence.map((e) => e.id))
    const missing = candidate.evidenceIds.filter((id) => !evidenceIds.has(id))
    if (missing.length > 0) {
      return `Evidence IDs not found: ${missing.join(', ')}`
    }

    const uniqueSources = new Set(
      evidence.filter((e) => candidate.evidenceIds.includes(e.id)).map((e) => e.source)
    )
    if (uniqueSources.size < 2) {
      return 'Correlation findings require evidence from at least 2 independent sources'
    }

    return null
  }

  private deriveConfidence(candidate: CorrelationCandidate, evidence: Evidence[]): number {
    // Confidence is independent from correlation score
    // Based on: evidence confidence average + source diversity
    const avgEvidenceConfidence =
      evidence.length > 0 ? evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length : 0.5

    const sourceDiversityFactor = Math.min(candidate.sourceTypes.length / 4, 1)

    const raw = avgEvidenceConfidence * 0.6 + sourceDiversityFactor * 0.4
    return Math.round(raw * 100) / 100
  }

  private buildTitle(candidate: CorrelationCandidate): string {
    const sources = candidate.sourceTypes.slice(0, 3).join(', ')
    return `Correlated signals detected across ${candidate.sourceTypes.length} source(s): ${sources}`
  }

  private buildDescription(candidate: CorrelationCandidate, evidence: Evidence[]): string {
    const sourceSummaries = this.groupBySource(evidence)
      .map(([source, items]) => `• ${source}: ${items.length} signal(s)`)
      .join('\n')

    return [
      candidate.reason,
      '',
      'Signals observed:',
      sourceSummaries,
      '',
      'Note: Temporal or topical overlap does not imply causation. This finding warrants further investigation.',
    ].join('\n')
  }

  private buildExplanationSummary(candidate: CorrelationCandidate, evidence: Evidence[]): string {
    const sourceList = candidate.sourceTypes.join(', ')
    return `${evidence.length} piece(s) of evidence from ${candidate.sourceTypes.length} independent source(s) (${sourceList}) were found to overlap. Rule applied: ${candidate.ruleId}.`
  }

  private buildConfidenceReason(
    candidate: CorrelationCandidate,
    evidence: Evidence[],
    confidence: number
  ): string {
    return [
      `Correlation score: ${candidate.score} (${candidate.sourceTypes.length} sources).`,
      `Finding confidence: ${confidence} (based on evidence quality and source diversity).`,
      `Correlation score measures signal strength; confidence measures reliability of this finding.`,
      `These are distinct values — a high correlation score does not guarantee high confidence.`,
    ].join(' ')
  }

  private groupBySource(evidence: Evidence[]): [string, Evidence[]][] {
    const map = new Map<string, Evidence[]>()
    for (const e of evidence) {
      const list = map.get(e.source) ?? []
      list.push(e)
      map.set(e.source, list)
    }
    return [...map.entries()]
  }

  private inferFindingType(candidate: CorrelationCandidate): Finding['type'] {
    // Metric degradation patterns → risk
    if (candidate.ruleId.includes('metric')) return 'risk'
    // Multi-source → opportunity for investigation
    return 'risk'
  }

  private inferPriority(score: number): Finding['priority'] {
    if (score >= 0.8) return 'high'
    if (score >= 0.6) return 'medium'
    return 'low'
  }

  private inferSeverity(score: number): Finding['severity'] {
    if (score >= 0.8) return 'high'
    if (score >= 0.6) return 'medium'
    if (score >= 0.4) return 'low'
    return 'info'
  }
}
