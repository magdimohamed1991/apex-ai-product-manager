# Pre-Step 2C Fixes Round 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 3 remaining architectural issues: prompt provenance serialization, retry usage accounting, and eliminate duplicate prompt builder.

**Architecture:** Update serializers to include provenance IDs, aggregate LLM usage across retries, and make the deprecated builder delegate to the canonical PromptRegistry.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

---

## Task 1: Preserve provenance in LLM prompt serializers

**Problem:** `serializeFindings`, `serializeExplanations`, and `serializeRecommendations` discard provenance IDs (evidenceIds, findingIds, insightIds) that the LLM needs to trace data back to evidence.

**Files:**

- Modify: `packages/prompts/src/variables/repository.ts`
- Modify: `packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts`

**Step 1: Update serializeFindings to include evidenceIds and id**

Replace the `serializeFindings` function:

```typescript
export function serializeFindings(findings: FindingDTO[]): string {
  if (findings.length === 0) return '- No correlation findings'
  return findings
    .map(
      (f) =>
        `- [${f.severity.toUpperCase()}/${f.type}] ${f.title}\n  ${f.description}\n  Evidence: ${f.evidenceIds.join(', ') || 'none'}${f.correlationId ? `\n  Correlation: ${f.correlationId}` : ''}`
    )
    .join('\n')
}
```

**Step 2: Update serializeExplanations to include evidenceIds and id**

Replace the `serializeExplanations` function:

```typescript
export function serializeExplanations(explanations: ExplanationDTO[]): string {
  if (explanations.length === 0) return '- No explanations available'
  return explanations
    .map(
      (e) =>
        `- ${e.summary}\n  Evidence: ${e.evidenceIds.join(', ') || 'none'}\n  Rules: ${e.appliedRules.join(', ')}\n  Confidence: ${e.confidenceReason}`
    )
    .join('\n')
}
```

**Step 3: Update serializeRecommendations to include origin detail**

The `RecommendationDTO` currently only has `origin: 'insight' | 'finding'`. The domain entity also has `insightIds`, `findingIds`, and `proposedActions`. We need to extend the DTO first.

In `packages/contracts/src/RecommendationDTO.ts`, add the missing fields:

```typescript
export interface RecommendationDTO {
  id: string
  title: string
  rationale: string
  impact: string
  effort: 'low' | 'medium' | 'high'
  priority: 'critical' | 'high' | 'medium' | 'low'
  confidence: number
  origin: 'insight' | 'finding'
  insightIds?: string[]
  findingIds?: string[]
}
```

Then update `serializeRecommendations` in `repository.ts`:

```typescript
export function serializeRecommendations(recommendations: RecommendationDTO[]): string {
  if (recommendations.length === 0) return '- No recommendations generated'
  return recommendations
    .map(
      (r) =>
        `- [${r.priority.toUpperCase()}] ${r.title}\n  Rationale: ${r.rationale}\n  Impact: ${r.impact} | Effort: ${r.effort} | Origin: ${r.origin}` +
        (r.findingIds?.length ? `\n  Findings: ${r.findingIds.join(', ')}` : '') +
        (r.insightIds?.length ? `\n  Insights: ${r.insightIds.join(', ')}` : '')
    )
    .join('\n')
}
```

**Step 4: Update the agent's toRecommendationDTOs to pass insightIds and findingIds**

In `packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts`, update the `toRecommendationDTOs` method (lines 134-147):

```typescript
private toRecommendationDTOs(
  recommendations: RepositoryAssessmentRequest['recommendations']
): RecommendationDTO[] {
  return recommendations.map((rec) => ({
    id: rec.id,
    title: rec.title,
    rationale: rec.rationale,
    impact: rec.impact,
    effort: rec.effort,
    priority: rec.priority,
    confidence: rec.confidence,
    origin: rec.origin,
    insightIds: rec.insightIds,
    findingIds: rec.findingIds,
  }))
}
```

**Step 5: Update tests**

In `packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts`:

1. Add findings and recommendations with provenance to mockVariables:

```typescript
findings: [
  {
    id: 'finding-1',
    type: 'risk',
    title: 'Checkout reliability contributing to conversion decline',
    description: 'Cross-source correlation detected.',
    severity: 'high',
    priority: 'high',
    evidenceIds: ['amp-checkout', 'gh-checkout'],
    correlationId: 'cross-source:amplitude-github',
  },
],
recommendations: [
  {
    id: 'rec-1',
    title: 'Investigate checkout flow',
    rationale: 'Correlated signals across sources.',
    impact: 'high',
    effort: 'medium',
    priority: 'high',
    confidence: 0.85,
    origin: 'finding',
    findingIds: ['finding-1'],
    insightIds: [],
  },
],
```

2. Add tests:

```typescript
it('includes finding evidence IDs in prompt', () => {
  const rendered = renderer.renderRepositoryIntelligence(mockVariables)
  expect(rendered.content).toContain('amp-checkout')
  expect(rendered.content).toContain('gh-checkout')
})

it('includes finding correlation ID in prompt', () => {
  const rendered = renderer.renderRepositoryIntelligence(mockVariables)
  expect(rendered.content).toContain('cross-source:amplitude-github')
})

it('includes recommendation origin and finding IDs in prompt', () => {
  const rendered = renderer.renderRepositoryIntelligence(mockVariables)
  expect(rendered.content).toContain('Origin: finding')
  expect(rendered.content).toContain('Findings: finding-1')
})

it('includes explanation evidence IDs in prompt', () => {
  const rendered = renderer.renderRepositoryIntelligence(mockVariables)
  expect(rendered.content).toContain('amp-checkout')
  expect(rendered.content).toContain('gh-checkout')
})
```

**Step 6: Run tests**

Run: `pnpm --filter @apex/prompts test -- --run` and `pnpm --filter @apex/ai-core test -- --run`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/prompts/src/variables/repository.ts packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts packages/contracts/src/RecommendationDTO.ts packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts
git commit -m "fix: preserve provenance IDs in LLM prompt serializers"
```

---

## Task 2: Aggregate LLM usage across retries

**Problem:** `parseAndValidate` calls the provider on retry but discards the retry's usage. Only the first request's token usage is recorded.

**Files:**

- Modify: `packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts`

**Step 1: Define a return type for parseAndValidate**

Add a new interface and update `parseAndValidate` to return aggregated usage:

```typescript
interface ParseResult {
  assessment: RepositoryAssessment
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  attempts: number
}
```

**Step 2: Rewrite parseAndValidate to aggregate usage**

Replace the entire `parseAndValidate` method:

```typescript
private async parseAndValidate(
  content: string,
  provider: LLMProvider,
  originalPrompt: string
): Promise<ParseResult> {
  let parsed: unknown
  let attempts = 1
  let totalPromptTokens = 0
  let totalCompletionTokens = 0

  // First attempt — already happened, usage passed in via `content`
  // We don't have the first response's usage here, so we track attempts
  // and let the caller handle first-request usage.

  try {
    parsed = this.validator.parseJSON(content)
  } catch {
    attempts++
    const retry = await provider.complete(originalPrompt, {
      maxTokens: this.budgetPolicy.maxTokensPerRequest,
    })
    totalPromptTokens += retry.usage.promptTokens
    totalCompletionTokens += retry.usage.completionTokens
    parsed = this.validator.parseJSON(retry.content)
  }

  const result = this.validator.validate(parsed)

  if (!result.valid) {
    attempts++
    const retry = await provider.complete(originalPrompt, {
      maxTokens: this.budgetPolicy.maxTokensPerRequest,
    })
    totalPromptTokens += retry.usage.promptTokens
    totalCompletionTokens += retry.usage.completionTokens
    const reparsed = this.validator.parseJSON(retry.content)
    const retryResult = this.validator.validate(reparsed)

    if (!retryResult.valid) {
      throw new Error(
        `LLM output failed validation after retry: ${retryResult.errors.join(', ')}`
      )
    }
    return {
      assessment: reparsed as RepositoryAssessment,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
      },
      attempts,
    }
  }

  return {
    assessment: parsed as RepositoryAssessment,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
    },
    attempts,
  }
}
```

**Step 3: Update the caller to aggregate usage**

In the `run` method, update lines 87-101:

```typescript
const response = await activeProvider.complete(prompt, {
  maxTokens: this.budgetPolicy.maxTokensPerRequest,
})
const parseResult = await this.parseAndValidate(response.content, activeProvider, prompt)

return this.mapper.toDomain(parseResult.assessment, context.workspaceId, {
  provider: activeProvider.name,
  model: activeProvider.model,
  promptVersion: this.promptVersion,
  tokenUsage: {
    prompt: response.usage.promptTokens + parseResult.usage.promptTokens,
    completion: response.usage.completionTokens + parseResult.usage.completionTokens,
    total: response.usage.totalTokens + parseResult.usage.totalTokens,
  },
})
```

**Step 4: Run tests**

Run: `pnpm --filter @apex/ai-core test -- --run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts
git commit -m "fix: aggregate LLM token usage across retry attempts"
```

---

## Task 3: Make deprecated builder delegate to PromptRegistry

**Problem:** `buildRepositoryIntelligencePrompt()` produces a different prompt than the canonical path, creating prompt drift.

**Files:**

- Modify: `packages/prompts/src/builders/repositoryIntelligencePrompt.ts`
- Modify: `packages/prompts/src/index.ts`

**Step 1: Rewrite the builder to delegate**

Replace the entire file content:

```typescript
import { promptRegistry } from '../registry/PromptRegistry'
import type { RepositoryPromptVariables } from '../variables/repository'

/**
 * @deprecated Use promptRegistry.get('repository-intelligence', variables) directly.
 * This wrapper exists for backward compatibility only and delegates to the canonical path.
 */
export function buildRepositoryIntelligencePrompt(input: RepositoryPromptVariables): string {
  const rendered = promptRegistry.get('repository-intelligence', input)
  return rendered.content
}
```

**Step 2: Update the barrel export comment**

In `packages/prompts/src/index.ts`, update the deprecation comment:

```typescript
/** @deprecated — use promptRegistry.get('repository-intelligence', variables) directly */
export { buildRepositoryIntelligencePrompt } from './builders/repositoryIntelligencePrompt'
```

**Step 3: Verify no other code imports the builder**

Run: `grep -r "buildRepositoryIntelligencePrompt" packages/ --include="*.ts" | grep -v "node_modules" | grep -v "index.ts" | grep -v "repositoryIntelligencePrompt.ts"`
Expected: Only the builder file and index.ts

**Step 4: Run tests**

Run: `pnpm --filter @apex/prompts test -- --run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/prompts/src/builders/repositoryIntelligencePrompt.ts packages/prompts/src/index.ts
git commit -m "fix: make deprecated prompt builder delegate to canonical PromptRegistry"
```

---

## Task 4: Final verification

**Step 1: Run all tests**

Run: `pnpm test -- --run`
Expected: All tests pass

**Step 2: Type check**

Run: `pnpm typecheck`
Expected: Clean

**Step 3: Lint**

Run: `pnpm lint`
Expected: Clean

**Step 4: Build**

Run: `pnpm build`
Expected: Succeeds

**Step 5: Commit if any fixups needed**

```bash
git add -A && git commit -m "fix: pre-step-2c round 2 — provenance, usage, prompt canonicalization"
```

---

## Summary

| #   | Issue                                        | Fix                                                                                    |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Prompt serializers discard provenance IDs    | Include evidenceIds, correlationId, findingIds, insightIds in serialized output        |
| 2   | Retry usage not aggregated                   | `parseAndValidate` returns aggregated usage + attempts; caller sums with first request |
| 3   | Deprecated builder produces different prompt | Rewrite to delegate to `promptRegistry.get()`                                          |
