import type { InsightDTO } from '@apex/contracts'
import type { RepositorySummary, Evidence } from '@apex/analysis'

export interface RepositoryIntelligencePromptInput {
  summary: RepositorySummary
  evidence: Evidence[]
  insights: InsightDTO[]
}

/**
 * Builds a structured prompt for the Repository Intelligence Agent.
 * LLM receives pre-analyzed data — not raw files.
 */
export function buildRepositoryIntelligencePrompt(
  input: RepositoryIntelligencePromptInput
): string {
  const { summary, evidence, insights } = input

  const summarySection = [
    `Name: ${summary.name}`,
    `Owner: ${summary.owner}`,
    `Languages: ${summary.languages.join(', ')}`,
    `Frameworks: ${summary.frameworks.join(', ') || 'none'}`,
    `Package Manager: ${summary.packageManager}`,
    `Has TypeScript: ${summary.hasTypeScript}`,
    `Has CI: ${summary.hasCI}`,
    `Has Tests: ${summary.hasTests}`,
    `Has Docker: ${summary.hasDocker}`,
    `Has Monorepo: ${summary.hasMonorepo}`,
    `Complexity: ${summary.complexity}`,
    `Readiness Score: ${summary.score}/100`,
  ].join('\n')

  const evidenceSection = evidence
    .map((e) => `- [${e.type}] ${e.key}: ${JSON.stringify(e.value)}`)
    .join('\n')

  const insightsSection = insights
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.title}\n  ${i.description}`)
    .join('\n')

  return `You are APEX, an autonomous Product Intelligence system.
Analyze the following structured repository data and produce actionable insights.
Work only with the data provided — do not hallucinate missing information.

## Repository Summary
${summarySection}

## Evidence
${evidenceSection}

## Static Analysis Insights
${insightsSection}

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
