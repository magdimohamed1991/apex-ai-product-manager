import type { InsightDTO, FindingDTO, RecommendationDTO } from '@apex/contracts'
import type { RepositorySummary, Evidence } from '@apex/analysis'
import {
  serializeSummary,
  serializeEvidence,
  serializeInsights,
  serializeFindings,
  serializeRecommendations,
} from '../variables/repository'

export interface RepositoryIntelligencePromptInput {
  summary: RepositorySummary
  evidence: Evidence[]
  insights: InsightDTO[]
  findings?: FindingDTO[]
  recommendations?: RecommendationDTO[]
}

/**
 * @deprecated Use PromptRegistry + PromptRenderer (the canonical path) instead.
 * This function is kept only for backward compatibility in tests and tooling.
 * It produces a DIFFERENT prompt than the canonical path — do not use in production.
 *
 * If you need to build a prompt programmatically, use:
 *   promptRegistry.get('repository-intelligence', variables)
 */
export function buildRepositoryIntelligencePrompt(
  input: RepositoryIntelligencePromptInput
): string {
  const summarySection = serializeSummary(input.summary)
  const evidenceSection = serializeEvidence(input.evidence)
  const insightsSection = serializeInsights(input.insights)
  const findingsSection = serializeFindings(input.findings ?? [])
  const recommendationsSection = serializeRecommendations(input.recommendations ?? [])

  return `You are APEX, an autonomous Product Intelligence system.
Analyze the following structured repository data and produce actionable insights.
Work only with the data provided — do not hallucinate missing information.

## Repository Summary
${summarySection}

## Evidence
${evidenceSection}

## Static Analysis Insights
${insightsSection}

## Correlation Findings
${findingsSection}

## Recommendations
${recommendationsSection}

## Your Task
Generate the following sections:

1. **Executive Summary** (2–3 sentences)
2. **Top 3 Risks** (severity + recommended action for each)
3. **Architecture Assessment** (strengths and concerns)
4. **Technical Debt** (low/medium/high + reasoning)
5. **Engineering Priorities** (ordered list of 3–5 actions)

Rules:
- Reference actual evidence values in your answers
- If evidence is missing for a claim, say so explicitly
- Be concise — Product Managers read fast
- Use plain language`
}
