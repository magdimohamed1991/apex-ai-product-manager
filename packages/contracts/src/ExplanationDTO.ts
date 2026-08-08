/**
 * Lightweight Explanation DTO for use in prompt building.
 * Avoids importing full domain entities from @apex/ai-core into @apex/prompts.
 */
export interface ExplanationDTO {
  id: string
  summary: string
  evidenceIds: string[]
  appliedRules: string[]
  confidenceReason: string
}
