# Pre-Step 2C Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 architectural issues identified in code review before proceeding to Step 2C (Action layer).

**Architecture:** Fix the CrossSourceCorrelationRule to apply temporal proximity per shared signal, render explanations in the LLM prompt, enforce maxTokensPerRequest on the provider, validate prompt versions, eliminate duplicate prompt paths, and add targeted regression tests.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

---

## Task 1: Fix CrossSourceCorrelationRule — temporal proximity per shared signal

**Problem:** The current rule checks shared keys and temporal proximity independently. Evidence can correlate even when the shared signal itself is not temporally proximate.

**Files:**

- Modify: `packages/ai-core/src/correlation/rules/CrossSourceCorrelationRule.ts:67-82`

**Step 1: Write the failing regression test**

Add to `packages/ai-core/src/correlation/__tests__/rules.test.ts` inside the `CrossSourceCorrelationRule` describe block:

```typescript
it('rejects correlation when shared key evidence is temporally distant but unrelated evidence overlaps', () => {
  // Amplitude has key "checkout" at day 0
  // GitHub has key "unrelated" at day 3 (temporally close to Amplitude)
  // Google Play has key "checkout" at day 90 (temporally distant from Amplitude)
  //
  // Shared key "checkout" exists between Amplitude + Google Play
  // But their evidence is 90 days apart (>30 day window)
  // GitHub + Amplitude overlap in time, but share no key
  // Expected: NO correlation (shared signal is not temporally proximate)
  const evidence: Evidence[] = [
    {
      id: 'amp-1',
      type: 'metric',
      source: 'amplitude',
      key: 'checkout',
      value: -18,
      confidence: 1,
      collectedAt: new Date(),
    },
    {
      id: 'gh-1',
      type: 'testing',
      source: 'github',
      key: 'unrelated',
      value: 'change',
      confidence: 1,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 3)
        return d
      })(),
    },
    {
      id: 'gplay-1',
      type: 'review',
      source: 'google_play',
      key: 'checkout',
      value: 27,
      confidence: 1,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 90)
        return d
      })(),
    },
  ]
  const candidates = rule.evaluate(evidence)
  expect(candidates).toHaveLength(0)
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @apex/ai-core test -- --run packages/ai-core/src/correlation/__tests__/rules.test.ts`
Expected: FAIL — the test currently passes because shared key + any temporal overlap satisfies the rule.

**Step 3: Rewrite the temporal proximity check**

Replace lines 67-82 of `CrossSourceCorrelationRule.ts` with logic that checks temporal proximity **per shared key**:

```typescript
// ── Temporal proximity check (per shared key) ──────────────────────────────
// For each shared key, collect evidence carrying that key grouped by source.
// Require ≥2 sources AND temporal proximity among those same evidence items.
let hasValidCorrelation = false
let correlatedEvidenceIds: string[] = []
let correlatedSharedKeys: string[] = []

for (const sharedKey of sharedKeys) {
  // Gather evidence items that carry this shared key, grouped by source
  const keyEvidenceBySource = new Map<string, Evidence[]>()
  for (const [source, items] of activeSources) {
    const matching = items.filter((item) => item.key === sharedKey)
    if (matching.length > 0) {
      keyEvidenceBySource.set(source, matching)
    }
  }

  // Need ≥2 sources carrying this key
  if (keyEvidenceBySource.size < 2) continue

  // Check temporal proximity among evidence carrying THIS key
  const sourceArrays = [...keyEvidenceBySource.values()]
  let keyHasTemporalOverlap = false
  for (let i = 0; i < sourceArrays.length; i++) {
    for (let j = i + 1; j < sourceArrays.length; j++) {
      if (hasTemporalOverlap(sourceArrays[i], sourceArrays[j], 30)) {
        keyHasTemporalOverlap = true
        break
      }
    }
    if (keyHasTemporalOverlap) break
  }

  if (keyHasTemporalOverlap) {
    hasValidCorrelation = true
    correlatedSharedKeys.push(sharedKey)
    // Collect evidence IDs for this shared key across sources
    for (const items of keyEvidenceBySource.values()) {
      for (const item of items) {
        if (!correlatedEvidenceIds.includes(item.id)) {
          correlatedEvidenceIds.push(item.id)
        }
      }
    }
  }
}

if (!hasValidCorrelation) {
  return []
}
```

**Step 4: Update the candidate builder**

Replace lines 84-105 to use `correlatedEvidenceIds` and `correlatedSharedKeys` instead of all evidence:

```typescript
// ── Build candidate ──────────────────────────────────────────────────────
// Only include evidence that contributed to a valid correlation
const contributingEvidence = allEvidence.filter((e) => correlatedEvidenceIds.includes(e.id))
const totalUniqueKeys = new Set(activeSources.flatMap(([, items]) => items.map((e) => e.key))).size
const topicSimilarity = Math.min(correlatedSharedKeys.length / totalUniqueKeys, 1)

const sourceTypes = activeSources.map(([source]) => source) as CorrelationCandidate['sourceTypes']

return [
  {
    id: `${this.id}:${sourceTypes.sort().join('-')}`,
    evidenceIds: contributingEvidence.map((e) => e.id),
    sourceTypes,
    score: scoreCorrelation(sourceTypes, contributingEvidence, topicSimilarity),
    reason: `Signals were detected across ${activeSources.length} independent sources (${sourceTypes.join(', ')}) with shared subject matter (${correlatedSharedKeys.join(', ')}) and temporal proximity. Higher confidence from source diversity — not from proven causation. Cross-referencing these signals may surface a common underlying issue.`,
    ruleId: this.id,
    createdAt: new Date(),
  },
]
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @apex/ai-core test -- --run packages/ai-core/src/correlation/__tests__/rules.test.ts`
Expected: PASS

**Step 6: Run full correlation test suite**

Run: `pnpm --filter @apex/ai-core test -- --run packages/ai-core/src/correlation/`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/ai-core/src/correlation/rules/CrossSourceCorrelationRule.ts packages/ai-core/src/correlation/__tests__/rules.test.ts
git commit -m "fix: apply temporal proximity per shared key in CrossSourceCorrelationRule"
```

---

## Task 2: Add real-world multi-source fixture proving CrossSourceCorrelationRule

**Problem:** Existing tests use `key: 'signal'` for all evidence, which doesn't prove the CrossSource rule works with realistic different-key data. The integration test at `CorrelationEngine.test.ts:83-92` finds a cross-source candidate but doesn't prove it came from the CrossSource rule specifically.

**Files:**

- Modify: `packages/ai-core/src/correlation/__tests__/rules.test.ts`
- Modify: `packages/ai-core/src/correlation/__tests__/CorrelationEngine.test.ts`

**Step 1: Add realistic shared-key fixture test to rules.test.ts**

Add inside the `CrossSourceCorrelationRule` describe block:

```typescript
it('correlates realistic evidence with same key across 3 sources', () => {
  const evidence: Evidence[] = [
    {
      id: 'amp-checkout',
      type: 'metric',
      source: 'amplitude',
      key: 'checkout',
      value: -18,
      confidence: 0.9,
      collectedAt: new Date(),
    },
    {
      id: 'gplay-checkout',
      type: 'review',
      source: 'google_play',
      key: 'checkout',
      value: 'users report checkout failures',
      confidence: 0.8,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 5)
        return d
      })(),
    },
    {
      id: 'gh-checkout',
      type: 'testing',
      source: 'github',
      key: 'checkout',
      value: 'checkout.ts modified',
      confidence: 0.95,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 3)
        return d
      })(),
    },
  ]
  const candidates = rule.evaluate(evidence)
  expect(candidates.length).toBe(1)
  expect(candidates[0].ruleId).toBe('cross-source-correlation')
  expect(candidates[0].evidenceIds).toContain('amp-checkout')
  expect(candidates[0].evidenceIds).toContain('gplay-checkout')
  expect(candidates[0].evidenceIds).toContain('gh-checkout')
})

it('does NOT correlate when shared key evidence is >30 days apart', () => {
  const evidence: Evidence[] = [
    {
      id: 'amp-checkout',
      type: 'metric',
      source: 'amplitude',
      key: 'checkout',
      value: -18,
      confidence: 0.9,
      collectedAt: new Date(),
    },
    {
      id: 'gplay-checkout',
      type: 'review',
      source: 'google_play',
      key: 'checkout',
      value: 'checkout issues',
      confidence: 0.8,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 60)
        return d
      })(),
    },
    {
      id: 'gh-unrelated',
      type: 'testing',
      source: 'github',
      key: 'readme',
      value: 'readme updated',
      confidence: 0.5,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 2)
        return d
      })(),
    },
  ]
  const candidates = rule.evaluate(evidence)
  expect(candidates).toHaveLength(0)
})
```

**Step 2: Update CorrelationEngine integration test**

Replace lines 83-92 of `CorrelationEngine.test.ts` to explicitly verify the cross-source candidate uses the shared key:

```typescript
it('cross-source candidate appears when 3 sources share a key', () => {
  const evidence: Evidence[] = [
    makeEvidence('amp-checkout', 'amplitude', -18, 0),
    makeEvidence('gplay-checkout', 'google_play', 27, 5),
    makeEvidence('gh-checkout', 'github', 'checkout.ts modified', 3),
  ]
  // Override keys to be shared
  evidence[0].key = 'checkout'
  evidence[1].key = 'checkout'
  evidence[2].key = 'checkout'

  const result = engine.evaluate(evidence)
  const crossSource = result.candidates.find((c) => c.ruleId === 'cross-source-correlation')
  expect(crossSource).toBeDefined()
  expect(crossSource!.evidenceIds).toContain('amp-checkout')
  expect(crossSource!.evidenceIds).toContain('gplay-checkout')
  expect(crossSource!.evidenceIds).toContain('gh-checkout')
})
```

**Step 3: Add regression test for temporal mismatch on shared key**

Add to `CorrelationEngine.test.ts`:

```typescript
it('cross-source candidate does NOT appear when shared key is temporally distant', () => {
  const evidence: Evidence[] = [
    {
      id: 'amp-1',
      type: 'metric',
      source: 'amplitude',
      key: 'checkout',
      value: -18,
      confidence: 1,
      collectedAt: new Date(),
    },
    {
      id: 'gplay-1',
      type: 'review',
      source: 'google_play',
      key: 'checkout',
      value: 27,
      confidence: 1,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 90)
        return d
      })(),
    },
    {
      id: 'gh-1',
      type: 'testing',
      source: 'github',
      key: 'unrelated',
      value: 'change',
      confidence: 1,
      collectedAt: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 3)
        return d
      })(),
    },
  ]
  const result = engine.evaluate(evidence)
  const crossSource = result.candidates.find((c) => c.ruleId === 'cross-source-correlation')
  expect(crossSource).toBeUndefined()
})
```

**Step 4: Run tests**

Run: `pnpm --filter @apex/ai-core test -- --run packages/ai-core/src/correlation/`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ai-core/src/correlation/__tests__/rules.test.ts packages/ai-core/src/correlation/__tests__/CorrelationEngine.test.ts
git commit -m "test: add regression tests for CrossSourceCorrelationRule shared-key temporal proximity"
```

---

## Task 3: Render explanations in the canonical intelligence prompt

**Problem:** `ExplanationDTO` is passed to `PromptRenderer` but silently dropped — no `serializeExplanations` function exists and no explanation section appears in the rendered prompt.

**Files:**

- Modify: `packages/prompts/src/variables/repository.ts`
- Modify: `packages/prompts/src/renderer/PromptRenderer.ts`
- Modify: `packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts`

**Step 1: Add serializeExplanations to repository.ts**

Append to `packages/prompts/src/variables/repository.ts`:

```typescript
export function serializeExplanations(explanations: ExplanationDTO[]): string {
  if (explanations.length === 0) return '- No explanations available'
  return explanations
    .map(
      (e) =>
        `- ${e.summary}\n  Rules: ${e.appliedRules.join(', ')}\n  Confidence: ${e.confidenceReason}`
    )
    .join('\n')
}
```

**Step 2: Update PromptRenderer to include explanations**

In `packages/prompts/src/renderer/PromptRenderer.ts`:

1. Add `serializeExplanations` to the import on line 3-8:

```typescript
import {
  serializeSummary,
  serializeEvidence,
  serializeInsights,
  serializeFindings,
  serializeRecommendations,
  serializeExplanations,
} from '../variables/repository'
```

2. Add serialization call after line 35:

```typescript
const explanationsText = serializeExplanations(variables.explanations)
```

3. Add explanation section after the `## Generated Recommendations` block (after line 54), before `## Required JSON Output Schema`:

```typescript
## Explanations / Provenance
${explanationsText}
```

4. Add `explanations` to the returned variables object (after line 100):

```typescript
explanations: explanationsText,
```

**Step 3: Add test for explanation rendering**

In `packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts`:

1. Update `mockVariables` to include a non-empty explanations array (after line 49):

```typescript
explanations: [
  {
    id: 'exp-1',
    summary: 'Checkout metric drop correlates with GitHub code changes',
    evidenceIds: ['amp-checkout', 'gh-checkout'],
    appliedRules: ['metric-code-correlation'],
    confidenceReason: 'High confidence from temporal overlap of metric drop and code change',
  },
],
```

2. Add test:

```typescript
it('includes explanations in prompt', () => {
  const rendered = renderer.renderRepositoryIntelligence(mockVariables)
  expect(rendered.content).toContain('Explanations')
  expect(rendered.content).toContain('Checkout metric drop correlates')
  expect(rendered.content).toContain('metric-code-correlation')
})

it('renders "No explanations available" when empty', () => {
  const vars = { ...mockVariables, explanations: [] }
  const rendered = renderer.renderRepositoryIntelligence(vars)
  expect(rendered.content).toContain('No explanations available')
})
```

**Step 4: Update PromptRegistry tests if needed**

The `PromptRegistry.test.ts` already passes `explanations: []` — no changes needed there.

**Step 5: Run tests**

Run: `pnpm --filter @apex/prompts test -- --run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/prompts/src/variables/repository.ts packages/prompts/src/renderer/PromptRenderer.ts packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts
git commit -m "feat: render explanations in the canonical intelligence prompt"
```

---

## Task 4: Enforce maxTokensPerRequest on the LLM provider

**Problem:** `BudgetPolicy.maxTokensPerRequest` is only used to decide whether to fallback to mock. When the real provider runs, no output token limit is passed.

**Files:**

- Modify: `packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts:87`
- Modify: `packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts:202,209`

**Step 1: Pass maxTokens to provider.complete() calls**

In `packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts`:

1. Line 87 — the initial call. Change from:

```typescript
const response = await activeProvider.complete(prompt)
```

to:

```typescript
const response = await activeProvider.complete(prompt, {
  maxTokens: this.budgetPolicy.maxTokensPerRequest,
})
```

2. Line 202 — parse retry. Change from:

```typescript
const retry = await provider.complete(originalPrompt)
```

to:

```typescript
const retry = await provider.complete(originalPrompt, {
  maxTokens: this.budgetPolicy.maxTokensPerRequest,
})
```

3. Line 209 — validation retry. Change from:

```typescript
const retry = await provider.complete(originalPrompt)
```

to:

```typescript
const retry = await provider.complete(originalPrompt, {
  maxTokens: this.budgetPolicy.maxTokensPerRequest,
})
```

**Step 2: Verify MockLLMProvider handles options (it already does)**

The `MockLLMProvider.complete()` accepts `options?: LLMOptions` and ignores it — no change needed.

**Step 3: Verify OpenAIResponsesProvider handles maxTokens**

The `OpenAIResponsesProvider.complete()` already reads `options?.maxTokens` and maps it to `max_output_tokens` — no change needed.

**Step 4: Run agent tests**

Run: `pnpm --filter @apex/ai-core test -- --run packages/ai-core/src/agents/`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts
git commit -m "fix: enforce maxTokensPerRequest on LLM provider calls"
```

---

## Task 5: PromptRegistry rejects unsupported versions

**Problem:** `registry.get('repository-intelligence', vars, 'v999')` silently renders using the latest version. Unknown versions should fail explicitly.

**Files:**

- Modify: `packages/prompts/src/registry/PromptRegistry.ts:37`
- Modify: `packages/prompts/src/registry/__tests__/PromptRegistry.test.ts`

**Step 1: Add version validation**

In `packages/prompts/src/registry/PromptRegistry.ts`, after line 37 (`const v = version ?? entry.latestVersion`), add:

```typescript
if (!entry.versions.includes(v)) {
  throw new Error(
    `Prompt "${id}" does not have version "${v}". Available versions: ${entry.versions.join(', ')}`
  )
}
```

**Step 2: Add test for rejected version**

In `packages/prompts/src/registry/__tests__/PromptRegistry.test.ts`, add:

```typescript
it('throws for unsupported version', () => {
  expect(() => registry.get('repository-intelligence', mockVars, 'v999')).toThrow(
    'does not have version "v999"'
  )
})
```

**Step 3: Run tests**

Run: `pnpm --filter @apex/prompts test -- --run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/prompts/src/registry/PromptRegistry.ts packages/prompts/src/registry/__tests__/PromptRegistry.test.ts
git commit -m "fix: reject unsupported prompt versions in PromptRegistry"
```

---

## Task 6: Eliminate duplicate prompt-building path

**Problem:** Three representations of the same prompt exist: `PromptRenderer` (canonical), `buildRepositoryIntelligencePrompt` (standalone), and `repository-intelligence.md` (stale template). This creates prompt drift.

**Files:**

- Modify: `packages/prompts/src/builders/repositoryIntelligencePrompt.ts`
- Delete or deprecate: `packages/prompts/src/templates/repository-intelligence.md`
- Modify: `packages/prompts/src/index.ts`

**Step 1: Deprecate the standalone builder**

In `packages/prompts/src/builders/repositoryIntelligencePrompt.ts`, update the JSDoc to mark it as deprecated and add a delegation comment:

```typescript
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
```

**Step 2: Update the barrel export to mark deprecation**

In `packages/prompts/src/index.ts`, add a comment:

```typescript
/** @deprecated — use promptRegistry.get() instead */
export { buildRepositoryIntelligencePrompt } from './builders/repositoryIntelligencePrompt'
```

**Step 3: Remove the stale markdown template**

Delete `packages/prompts/src/templates/repository-intelligence.md` — it is not consumed by any code and is out of sync with the actual prompt.

**Step 4: Verify no imports reference the deleted template**

Run: `grep -r "repository-intelligence.md" packages/`
Expected: No results

**Step 5: Run full prompts test suite**

Run: `pnpm --filter @apex/prompts test -- --run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/prompts/src/builders/repositoryIntelligencePrompt.ts packages/prompts/src/index.ts
git rm packages/prompts/src/templates/repository-intelligence.md
git commit -m "chore: deprecate standalone prompt builder, remove stale template"
```

---

## Task 7: Final verification — full test suite

**Step 1: Run all tests across all packages**

Run: `pnpm test -- --run`
Expected: All tests pass

**Step 2: Run type checking**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Run linting**

Run: `pnpm lint`
Expected: No lint errors

**Step 4: Run build**

Run: `pnpm build`
Expected: Build succeeds

**Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address all 6 pre-step-2c review items"
```

---

## Summary of Changes

| #   | Issue                      | Fix                                                   | Files Changed                                                               |
| --- | -------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | CrossSource temporal logic | Temporal proximity now checked per shared key         | `CrossSourceCorrelationRule.ts`                                             |
| 2   | Regression tests           | Tests for shared-key temporal mismatch                | `rules.test.ts`, `CorrelationEngine.test.ts`                                |
| 3   | Explanations dropped       | Added `serializeExplanations` + rendering section     | `repository.ts`, `PromptRenderer.ts`, `PromptRenderer.test.ts`              |
| 4   | maxTokens not enforced     | Pass `maxTokens` to all `provider.complete()` calls   | `RepositoryIntelligenceAgent.ts`                                            |
| 5   | Version validation         | `PromptRegistry.get()` rejects unknown versions       | `PromptRegistry.ts`, `PromptRegistry.test.ts`                               |
| 6   | Duplicate prompt paths     | Deprecated standalone builder, removed stale template | `repositoryIntelligencePrompt.ts`, `index.ts`, `repository-intelligence.md` |
