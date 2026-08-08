import type { SourceType } from './SourceType'

/**
 * Lightweight Insight DTO for use in prompt building.
 * Avoids importing full domain entities from @apex/ai-core into @apex/prompts.
 */
export interface InsightDTO {
  id: string
  title: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  confidence: number
  source: SourceType
  evidence: string[]
  tags: string[]
}
