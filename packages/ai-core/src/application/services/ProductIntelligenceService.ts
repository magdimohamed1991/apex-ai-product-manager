import type { Recommendation, ProductImpactAssessment, RichRecommendation, PMCategory } from '../../domain/entities'

const WEIGHTS = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

/**
 * Product Intelligence Service (Milestone H3)
 *
 * Implements a 100% deterministic, explainable, and trace-backed prioritization engine.
 * Maps raw code observations into deep product reasoning vectors (Severity, Business/User Impact,
 * Delivery/Operational Risk) to deliver high-fidelity comparative decision reasoning for Product Managers.
 */
export class ProductIntelligenceService {
  
  /**
   * Evaluates and decorates raw recommendations into rich decision-oriented PM objects
   */
  assessAndRank(recs: Recommendation[]): RichRecommendation[] {
    // 1. Map each raw Recommendation to a structured RichRecommendation with individual impact assessments
    const richRecs: RichRecommendation[] = recs.map((rec) => {
      const assessment = this.determineImpactAssessment(rec)
      const priorityScore = this.calculatePriorityScore(assessment)
      const pmCategory = this.determinePMCategory(rec)
      const expectedOutcome = this.determineExpectedOutcome(rec)

      return {
        ...rec,
        pmCategory,
        assessment,
        priorityScore,
        expectedOutcome,
        rankingReason: '', // To be filled dynamically during comparative ranking
      }
    })

    // 2. Sort recommendations descending by priority score (Highest ROI / Priority first)
    const sorted = richRecs.sort((a, b) => b.priorityScore - a.priorityScore)

    // 3. Generate natural, machine-readable comparative ranking explanations (Item 4)
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]
      if (i === 0 && sorted.length > 1) {
        const next = sorted[i + 1]
        current.rankingReason = `Ranked #1 because it addresses a higher release reliability risk (${current.pmCategory}) with lower comparative effort (${current.assessment.effort}) than ${next.title}.`
      } else if (i < sorted.length - 1) {
        const next = sorted[i + 1]
        current.rankingReason = `Ranked above ${next.title} due to higher risk exposure impact score of ${current.priorityScore.toFixed(1)} vs ${next.priorityScore.toFixed(1)}.`
      } else {
        current.rankingReason = `Ranked baseline priority due to lower comparative product regression risk.`
      }
    }

    return sorted
  }

  /**
   * Deterministic scoring engine (Item 2)
   * Formula: Score = (Severity + Business + User + Delivery + Operational) * Confidence / Effort
   */
  private calculatePriorityScore(assessment: ProductImpactAssessment): number {
    const severityVal = WEIGHTS[assessment.severity]
    const businessVal = WEIGHTS[assessment.businessImpact]
    const userVal = WEIGHTS[assessment.userImpact]
    const deliveryVal = WEIGHTS[assessment.deliveryRisk]
    const operationalVal = WEIGHTS[assessment.operationalRisk]
    const effortVal = WEIGHTS[assessment.effort]

    const totalRisk = severityVal + businessVal + userVal + deliveryVal + operationalVal
    const score = (totalRisk * assessment.confidence) / effortVal
    
    // Return rounded normalized score (e.g. 1 decimal)
    return Math.round(score * 10) / 10
  }

  /**
   * Determines structured product impact dimensions based on recommendation titles and attributes (Item 1)
   */
  private determineImpactAssessment(rec: Recommendation): ProductImpactAssessment {
    const title = rec.title.toLowerCase()

    // 1. CI / CD recommendations
    if (title.includes('ci') || title.includes('continuous integration')) {
      return {
        severity: 'high',
        businessImpact: 'high',
        userImpact: 'medium',
        deliveryRisk: 'critical', // Unvalidated PR code introduces massive delivery release risks!
        operationalRisk: 'medium',
        effort: 'low',
        confidence: rec.confidence,
      }
    }

    // 2. Automated testing recommendations
    if (title.includes('test') || title.includes('vitest')) {
      return {
        severity: 'high',
        businessImpact: 'high',
        userImpact: 'high', // Defects leak directly to user experiences
        deliveryRisk: 'high',
        operationalRisk: 'critical', // Support load multiplies without unit test safety gates
        effort: 'medium',
        confidence: rec.confidence,
      }
    }

    // 3. TypeScript recommendations
    if (title.includes('typescript') || title.includes('type checking')) {
      return {
        severity: 'medium',
        businessImpact: 'medium',
        userImpact: 'low',
        deliveryRisk: 'medium',
        operationalRisk: 'high', // Increases codebase technical debt and maintenance burden
        effort: 'low',
        confidence: rec.confidence,
      }
    }

    // Default baseline fallback (always safe, deterministic, non-hallucinated)
    return {
      severity: 'low',
      businessImpact: 'low',
      userImpact: 'low',
      deliveryRisk: 'low',
      operationalRisk: 'low',
      effort: 'low',
      confidence: rec.confidence,
    }
  }

  /**
   * Maps observations to standard PM Categories (Item 3)
   */
  private determinePMCategory(rec: Recommendation): PMCategory {
    const title = rec.title.toLowerCase()
    if (title.includes('test')) return 'CRITICAL_PRODUCT_RISK'
    if (title.includes('ci')) return 'DELIVERY_RISK'
    if (title.includes('typescript')) return 'TECHNICAL_DEBT'
    return 'IMPROVEMENT_OPPORTUNITY'
  }

  /**
   * Deterministic PM-oriented expected outcome generator
   */
  private determineExpectedOutcome(rec: Recommendation): string {
    const title = rec.title.toLowerCase()
    if (title.includes('test')) {
      return 'Every pull request receives automated unit test regression validation before merging.'
    }
    if (title.includes('ci')) {
      return 'Provides rapid automated builds for every code commit, eliminating manual release errors.'
    }
    if (title.includes('typescript')) {
      return 'Guarantees absolute compile-time type safety, eliminating uncaught null pointer and runtime crashes.'
    }
    return 'Establishes general codebase reliability improvements.'
  }
}
