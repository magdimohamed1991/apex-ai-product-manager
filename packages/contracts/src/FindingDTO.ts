/**
 * Lightweight Finding DTO for use in prompt building.
 * Avoids importing full domain entities from @apex/ai-core into @apex/prompts.
 */
export interface FindingDTO {
  id: string
  type: 'bug' | 'opportunity' | 'risk' | 'growth'
  title: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  priority: 'critical' | 'high' | 'medium' | 'low'
  evidenceIds: string[]
  correlationId?: string
}
