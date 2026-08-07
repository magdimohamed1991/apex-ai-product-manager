import type { RepositoryPromptVariables } from '../variables/repository'
import { serializeSummary, serializeEvidence, serializeInsights } from '../variables/repository'

export interface RenderedPrompt {
  id: string
  version: string
  content: string
  variables: Record<string, string>
  renderedAt: Date
}

/**
 * Renders prompt templates by injecting typed variables.
 * Versioned output enables A/B testing of prompt changes.
 */
export class PromptRenderer {
  renderRepositoryIntelligence(
    variables: RepositoryPromptVariables,
    version = 'v1'
  ): RenderedPrompt {
    const summaryText = serializeSummary(variables.summary)
    const evidenceText = serializeEvidence(variables.evidence)
    const insightsText = serializeInsights(variables.insights)

    const content = `You are APEX, an autonomous Product Intelligence system.
Analyze the following pre-processed repository data and return a structured JSON assessment.
Do NOT return Markdown. Return only valid JSON matching the RepositoryAssessment schema.

## Repository Summary
${summaryText}

## Evidence
${evidenceText}

## Static Analysis Insights
${insightsText}

## Required JSON Output Schema
{
  "executiveSummary": "string (2-3 sentences)",
  "strengths": ["string"],
  "risks": [
    {
      "title": "string",
      "severity": "critical|high|medium|low",
      "description": "string",
      "recommendedAction": "string"
    }
  ],
  "technicalDebt": {
    "level": "low|medium|high|critical",
    "reasoning": "string",
    "estimatedEffortDays": number | null
  },
  "engineeringPriorities": [
    {
      "rank": number,
      "title": "string",
      "rationale": "string",
      "effort": "low|medium|high",
      "impact": "low|medium|high"
    }
  ],
  "confidence": number
}

Rules:
- Reference actual evidence values — do not hallucinate
- If evidence is missing for a claim, say "insufficient data"
- Return ONLY the JSON object — no preamble, no explanation`

    return {
      id: `repository-intelligence-${version}`,
      version,
      content,
      variables: {
        summary: summaryText,
        evidence: evidenceText,
        insights: insightsText,
      },
      renderedAt: new Date(),
    }
  }
}
