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
 * Builds a structured prompt for the Repository Intelligence Agent.
 * LLM receives pre-analyzed data — not raw files.
 *
 * Prefer PromptRegistry + PromptRenderer (the canonical path) over this
 * standalone function. This is kept for direct invocation in tests and tooling.
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
