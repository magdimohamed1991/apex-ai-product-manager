import type { Recommendation } from './Recommendation'

export type PMCategory =
  | 'CRITICAL_PRODUCT_RISK'
  | 'DELIVERY_RISK'
  | 'TECHNICAL_DEBT'
  | 'IMPROVEMENT_OPPORTUNITY'

export interface ProductImpactAssessment {
  severity: 'low' | 'medium' | 'high' | 'critical'
  businessImpact: 'low' | 'medium' | 'high' | 'critical'
  userImpact: 'low' | 'medium' | 'high' | 'critical'
  deliveryRisk: 'low' | 'medium' | 'high' | 'critical'
  operationalRisk: 'low' | 'medium' | 'high' | 'critical'
  effort: 'low' | 'medium' | 'high'
  confidence: number
}

export interface RichRecommendation extends Recommendation {
  pmCategory: PMCategory
  assessment: ProductImpactAssessment
  priorityScore: number
  expectedOutcome: string
  rankingReason: string
}
