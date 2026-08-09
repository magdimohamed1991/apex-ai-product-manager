import type { RichRecommendation } from '../../domain/entities'
import type { AdaptiveLearningProfile, PriorityCalibration, LearningSignal } from '../../domain/entities/ProductAdaptive'

/**
 * H6 Prioritization Calibrator (Milestone H6)
 *
 * Calibrates canonical H3 baseline scores based on PM preference and outcome reliability,
 * strictly keeping the baseline immutable and preserving critical objective safety risks.
 */
export class H6PrioritizationCalibrator {
  /**
   * Performs dynamic H6 calibration on an H3 baseline score (Item 2 & Item 8)
   */
  calibrate(
    recommendation: RichRecommendation,
    profile: AdaptiveLearningProfile | null,
    signals: LearningSignal[]
  ): PriorityCalibration {
    const baseScore = recommendation.priorityScore || 5.0

    if (!profile) {
      return {
        baseScore,
        calibratedScore: baseScore,
        preferenceMultiplier: 1.0,
        outcomeReliabilityMultiplier: 1.0,
        appliedSignals: [],
        explanation: 'No adaptive learning profile currently compiled for this project scope. Using baseline H3 score.',
      }
    }

    const category = this.getCategory(recommendation.title)
    if (!category) {
      return {
        baseScore,
        calibratedScore: baseScore,
        preferenceMultiplier: 1.0,
        outcomeReliabilityMultiplier: 1.0,
        appliedSignals: [],
        explanation: 'This recommendation does not fall under an adaptive prioritization category. Using baseline H3 score.',
      }
    }

    const coef = profile.categoryCoefficients.find((c) => c.category === category)
    const preferenceMultiplier = coef ? coef.pmCalibrationWeight : 1.0
    
    // Outcome success multiplier: range from 0.8 to 1.2
    const outcomeVerifiedRate = coef ? coef.outcomeVerifiedRate : 0.5
    const outcomeReliabilityMultiplier = 1.0 + (outcomeVerifiedRate - 0.5) * 0.4

    let calibratedScore = baseScore * preferenceMultiplier * outcomeReliabilityMultiplier
    let riskPreserved = false

    // 🔒 Enforce Invariant: Preserves objective risk - do not deflate critical or high risks to zero (Item 2)
    if (recommendation.priority === 'critical' && calibratedScore < 8.5) {
      calibratedScore = 8.5
      riskPreserved = true
    } else if (recommendation.priority === 'high' && calibratedScore < 7.0) {
      calibratedScore = 7.0
      riskPreserved = true
    }

    calibratedScore = Math.round(calibratedScore * 10) / 10

    // Filter signals applied specifically to this category
    const appliedSignals = signals.filter((s) => s.category === category)

    let explanation = `APEX adjusted the priority score from baseline ${baseScore} to ${calibratedScore} using empirical signals (adoption weight: ${preferenceMultiplier.toFixed(2)}, outcome verification weight: ${outcomeReliabilityMultiplier.toFixed(2)}).`
    if (riskPreserved) {
      explanation += ` Safety floor was explicitly enforced to preserve critical objective risk.`
    }

    return {
      baseScore,
      calibratedScore,
      preferenceMultiplier,
      outcomeReliabilityMultiplier,
      appliedSignals,
      explanation,
    }
  }

  private getCategory(title: string): string | null {
    const t = title.toLowerCase()
    if (t.includes('test') || t.includes('testing')) return 'TESTING'
    if (t.includes('ci') || t.includes('workflow') || t.includes('action')) return 'CI_CD'
    if (t.includes('typescript') || t.includes('type check')) return 'TYPESCRIPT'
    if (t.includes('docker') || t.includes('dockerfile')) return 'DOCKER'
    return null
  }
}
