import type { RepositoryPromptVariables } from '../variables/repository'
import {
  serializeSummary,
  serializeEvidence,
  serializeInsights,
  serializeFindings,
  serializeRecommendations,
} from '../variables/repository'

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
 *
 * This is the single canonical location where prompt strings are constructed.
 * The RepositoryIntelligenceAgent delegates here via PromptRegistry —
 * no inline prompt building in agents.
 */
export class PromptRenderer {
  renderRepositoryIntelligence(
    variables: RepositoryPromptVariables,
    version = 'v1'
  ): RenderedPrompt {
    const summaryText = serializeSummary(variables.summary)
    const evidenceText = serializeEvidence(variables.evidence)
    const insightsText = serializeInsights(variables.insights)
    const findingsText = serializeFindings(variables.findings)
    const recommendationsText = serializeRecommendations(variables.recommendations)

    const content = `You are APEX, an autonomous Product Intelligence system.
Analyze the following pre-processed repository data and return a structured JSON assessment.
Do NOT return Markdown. Return only valid JSON matching the RepositoryAssessment schema.

## Repository Summary
${summaryText}

## Evidence (structured facts from static analysis)
${evidenceText}

## Static Analysis Insights
${insightsText}

## Correlation Findings (synthesized from cross-source signals)
${findingsText}

## Generated Recommendations
${recommendationsText}

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
- Consider the Correlation Findings and Recommendations in your assessment
- Return ONLY the JSON object — no preamble, no explanation`

    return {
      id: `repository-intelligence-${version}`,
      version,
      content,
      variables: {
        summary: summaryText,
        evidence: evidenceText,
        insights: insightsText,
        findings: findingsText,
        recommendations: recommendationsText,
      },
      renderedAt: new Date(),
    }
  }
}
