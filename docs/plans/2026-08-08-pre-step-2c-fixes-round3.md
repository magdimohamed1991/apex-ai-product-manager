# Pre-Step 2C Fixes Round 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 remaining architectural issues: source participation in correlation, explanation DTO provenance, external evidence validation, correlation ID uniqueness, proposedActions population, evidence serialization, and dependency documentation.

**Architecture:** Fix CrossSourceCorrelationRule to only count correlated sources, extend ExplanationDTO with insightIds/findingIds, validate external evidence at pipeline boundary, make correlation IDs signal-specific, populate proposedActions in all strategies, enrich evidence serialization, and document dependency rules.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

---

## Task 1: CrossSourceCorrelationRule — only count correlated sources

**Problem:** All sources in the input become `sourceTypes` even if only 2 participate in the shared-key correlation. This inflates source diversity scoring.

**Files:**

- Modify: `packages/ai-core/src/correlation/rules/CrossSourceCorrelationRule.ts`
- Modify: `packages/ai-core/src/correlation/__tests__/rules.test.ts`
- Modify: `packages/ai-core/src/correlation/__tests__/CorrelationEngine.test.ts`

**Step 1: Track sources that participate in the correlated signal**

In `CrossSourceCorrelationRule.ts`, add a `correlatedSources` set alongside `correlatedEvidenceIds` and `correlatedSharedKeys`:

```typescript
const correlatedSources = new Set<string>()
```

In the `if (keyHasTemporalOverlap)` block (line 97-105), add:

```typescript
if (keyHasTemporalOverlap) {
  hasValidCorrelation = true
  correlatedSharedKeys.push(sharedKey)
  for (const [source, items] of keyEvidenceBySource.entries()) {
    correlatedSources.add(source)
    for (const item of items) {
      correlatedEvidenceIds.add(item.id)
    }
  }
}
```

**Step 2: Use correlated sources for sourceTypes, scoring, and ID**

Replace lines 112-133:

```typescript
// ── Build candidate ──────────────────────────────────────────────────────
// Only count sources that actually participate in the correlated signal
const contributingEvidence = allEvidence.filter((e) => correlatedEvidenceIds.has(e.id))
const totalUniqueKeys = new Set(activeSources.flatMap(([, items]) => items.map((e) => e.key))).size
const topicSimilarity = Math.min(correlatedSharedKeys.length / totalUniqueKeys, 1)

const correlatedSourceTypes = [...correlatedSources].sort() as CorrelationCandidate['sourceTypes']

return [
  {
    id: `${this.id}:${correlatedSourceTypes.join('-')}:${correlatedSharedKeys.sort().join('-')}`,
    evidenceIds: contributingEvidence.map((e) => e.id),
    sourceTypes: correlatedSourceTypes,
    score: scoreCorrelation(correlatedSourceTypes, contributingEvidence, topicSimilarity),
    reason: `Signals were detected across ${correlatedSourceTypes.length} independent sources (${correlatedSourceTypes.join(', ')}) with shared subject matter (${correlatedSharedKeys.join(', ')}) and temporal proximity. Higher confidence from source diversity — not from proven causation. Cross-referencing these signals may surface a common underlying issue.`,
    ruleId: this.id,
    createdAt: new Date(),
  },
]
```

**Step 3: Add test for source participation**

In `rules.test.ts`, add inside the `CrossSourceCorrelationRule` describe block:

```typescript
it('only counts sources that participate in the correlated signal', () => {
  const now = new Date()
  const d3 = new Date()
  d3.setDate(d3.getDate() - 3)
  const evidence: Evidence[] = [
    {
      id: 'amp-checkout',
      type: 'metric',
      source: 'amplitude',
      key: 'checkout',
      value: -18,
      confidence: 0.9,
      collectedAt: now,
    },
    {
      id: 'gplay-checkout',
      type: 'review',
      source: 'google_play',
      key: 'checkout',
      value: 'checkout issues',
      confidence: 0.8,
      collectedAt: d3,
    },
    {
      id: 'gh-unrelated',
      type: 'testing',
      source: 'github',
      key: 'readme',
      value: 'readme updated',
      confidence: 0.5,
      collectedAt: d3,
    },
  ]
  const candidates = rule.evaluate(evidence)
  // Only amplitude + google_play share 'checkout' — github has 'readme'
  // CrossSource requires 3+ correlated sources, so this should produce NO candidate
  expect(candidates).toHaveLength(0)
})

it('correlation ID includes shared signal name', () => {
  const evidence: Evidence[] = [
    makeEvidence('amp-1', 'amplitude', -15, 0),
    makeEvidence('gplay-1', 'google_play', 10, 5),
    makeEvidence('gh-1', 'github', 'change', 3),
  ]
  const candidates = rule.evaluate(evidence)
  expect(candidates[0].id).toMatch(/signal/)
})
```

**Step 4: Add engine test for partial participation**

In `CorrelationEngine.test.ts`, add:

```typescript
it('cross-source candidate does NOT appear when only 2 sources share a key (3rd source unrelated)', () => {
  const now = new Date()
  const d3 = new Date()
  d3.setDate(d3.getDate() - 3)
  const evidence: Evidence[] = [
    {
      id: 'amp-checkout',
      type: 'metric',
      source: 'amplitude',
      key: 'checkout',
      value: -18,
      confidence: 1,
      collectedAt: now,
    },
    {
      id: 'gplay-checkout',
      type: 'review',
      source: 'google_play',
      key: 'checkout',
      value: 27,
      confidence: 1,
      collectedAt: d3,
    },
    {
      id: 'gh-readme',
      type: 'testing',
      source: 'github',
      key: 'readme',
      value: 'readme updated',
      confidence: 1,
      collectedAt: d3,
    },
  ]
  const result = engine.evaluate(evidence)
  const crossSource = result.candidates.find((c) => c.ruleId === 'cross-source-correlation')
  expect(crossSource).toBeUndefined()
})
```

**Step 5: Update existing test for correlation ID format**

The test at `CorrelationEngine.test.ts:178-188` (dedup test) may need adjustment if the ID format changed. Verify it still passes.

**Step 6: Run tests**

Run: `pnpm --filter @apex/ai-core test -- --run`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/ai-core/src/correlation/
git commit -m "fix: CrossSourceCorrelationRule only counts sources participating in correlated signal"
```

---

## Task 2: Preserve Explanation.insightIds and findingIds in DTO and prompt

**Problem:** `ExplanationDTO` drops `insightIds` and `findingIds`, breaking the provenance chain into the LLM prompt.

**Files:**

- Modify: `packages/contracts/src/ExplanationDTO.ts`
- Modify: `packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts`
- Modify: `packages/prompts/src/variables/repository.ts`
- Modify: `packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts`

**Step 1: Extend ExplanationDTO**

In `packages/contracts/src/ExplanationDTO.ts`:

```typescript
export interface ExplanationDTO {
  id: string
  summary: string
  evidenceIds: string[]
  appliedRules: string[]
  confidenceReason: string
  insightIds?: string[]
  findingIds?: string[]
}
```

**Step 2: Update agent's toExplanationDTOs**

In `RepositoryIntelligenceAgent.ts`, update the `toExplanationDTOs` method:

```typescript
private toExplanationDTOs(
  explanations: RepositoryAssessmentRequest['explanations']
): ExplanationDTO[] {
  return explanations.map((exp) => ({
    id: exp.id,
    summary: exp.summary,
    evidenceIds: exp.evidenceIds,
    appliedRules: exp.appliedRules,
    confidenceReason: exp.confidenceReason,
    insightIds: exp.insightIds,
    findingIds: exp.findingIds,
  }))
}
```

**Step 3: Update serializeExplanations**

In `repository.ts`, update `serializeExplanations`:

```typescript
export function serializeExplanations(explanations: ExplanationDTO[]): string {
  if (explanations.length === 0) return '- No explanations available'
  return explanations
    .map(
      (e) =>
        `- ${e.summary}\n  Evidence: ${e.evidenceIds.join(', ') || 'none'}` +
        (e.findingIds?.length ? `\n  Findings: ${e.findingIds.join(', ')}` : '') +
        (e.insightIds?.length ? `\n  Insights: ${e.insightIds.join(', ')}` : '') +
        `\n  Rules: ${e.appliedRules.join(', ')}\n  Confidence: ${e.confidenceReason}`
    )
    .join('\n')
}
```

**Step 4: Update tests**

In `PromptRenderer.test.ts`, update the mock explanation to include findingIds/insightIds:

```typescript
explanations: [
  {
    id: 'exp-1',
    summary: 'Checkout metric drop correlates with GitHub code changes',
    evidenceIds: ['amp-checkout', 'gh-checkout'],
    appliedRules: ['metric-code-correlation'],
    confidenceReason: 'High confidence from temporal overlap',
    findingIds: ['finding-1'],
    insightIds: [],
  },
],
```

Add test:

```typescript
it('includes explanation finding IDs in prompt', () => {
  const rendered = renderer.renderRepositoryIntelligence(mockVariables)
  expect(rendered.content).toContain('Findings: finding-1')
})
```

**Step 5: Run tests**

Run: `pnpm --filter @apex/prompts test -- --run && pnpm --filter @apex/ai-core test -- --run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/contracts/src/ExplanationDTO.ts packages/ai-core/src/agents/implementations/repository/RepositoryIntelligenceAgent.ts packages/prompts/src/variables/repository.ts packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts
git commit -m "fix: preserve insightIds and findingIds in ExplanationDTO and prompt serialization"
```

---

## Task 3: Validate external evidence at pipeline boundary

**Problem:** External evidence can bypass `createEvidence()` factory, allowing source/sourceReference mismatches.

**Files:**

- Modify: `packages/ai-core/src/intelligence/pipeline/RepositoryDiscoveryPipeline.ts`

**Step 1: Add createEvidence import**

Add to the imports at the top:

```typescript
import { createEvidence } from '@apex/analysis'
```

**Step 2: Validate external evidence in the run method**

After line 78 (`const evidence = [...repoEvidence, ...(input.externalEvidence ?? [])]`), add validation:

```typescript
// Validate external evidence provenance at ingestion boundary
for (const e of input.externalEvidence ?? []) {
  createEvidence(e)
}
```

This ensures that any external evidence with a `sourceReference` has matching `source`.

**Step 3: Add test for validation**

In `packages/ai-core/src/intelligence/pipeline/__tests__/RepositoryDiscoveryPipeline.test.ts`, add:

```typescript
it('rejects external evidence with source/sourceReference mismatch', () => {
  const badEvidence: Evidence[] = [
    {
      id: 'bad-1',
      type: 'metric',
      source: 'github',
      key: 'test',
      value: 0,
      confidence: 1,
      collectedAt: new Date(),
      sourceReference: {
        sourceType: 'google_play',
        externalId: '123',
        url: 'https://example.com',
      },
    },
  ]
  expect(() =>
    pipeline.run({
      workspaceId: WORKSPACE_ID,
      files: minimalRepo,
      externalEvidence: badEvidence,
    })
  ).toThrow('Evidence provenance mismatch')
})
```

**Step 4: Run tests**

Run: `pnpm --filter @apex/ai-core test -- --run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ai-core/src/intelligence/pipeline/RepositoryDiscoveryPipeline.ts packages/ai-core/src/intelligence/pipeline/__tests__/RepositoryDiscoveryPipeline.test.ts
git commit -m "fix: validate external evidence provenance at pipeline ingestion boundary"
```

---

## Task 4: Make correlation ID include shared signal name

**Problem:** Same source combination produces same ID even for different signals (e.g., "amplitude+github:checkout" vs "amplitude+github:payments").

**Note:** This is already addressed in Task 1 (the ID now includes `correlatedSharedKeys`). This task adds a dedicated test.

**Files:**

- Modify: `packages/ai-core/src/correlation/__tests__/rules.test.ts`

**Step 1: Add test for distinct signal IDs**

```typescript
it('produces different IDs for different shared signals from same sources', () => {
  const now = new Date()
  const d3 = new Date()
  d3.setDate(d3.getDate() - 3)
  const evidenceA: Evidence[] = [
    {
      id: 'amp-1',
      type: 'metric',
      source: 'amplitude',
      key: 'checkout',
      value: -18,
      confidence: 0.9,
      collectedAt: now,
    },
    {
      id: 'gplay-1',
      type: 'review',
      source: 'google_play',
      key: 'checkout',
      value: 'issues',
      confidence: 0.8,
      collectedAt: d3,
    },
    {
      id: 'gh-1',
      type: 'testing',
      source: 'github',
      key: 'checkout',
      value: 'changed',
      confidence: 0.95,
      collectedAt: d3,
    },
  ]
  const evidenceB: Evidence[] = [
    {
      id: 'amp-2',
      type: 'metric',
      source: 'amplitude',
      key: 'payments',
      value: -10,
      confidence: 0.9,
      collectedAt: now,
    },
    {
      id: 'gplay-2',
      type: 'review',
      source: 'google_play',
      key: 'payments',
      value: 'issues',
      confidence: 0.8,
      collectedAt: d3,
    },
    {
      id: 'gh-2',
      type: 'testing',
      source: 'github',
      key: 'payments',
      value: 'changed',
      confidence: 0.95,
      collectedAt: d3,
    },
  ]
  const idA = rule.evaluate(evidenceA)[0]?.id
  const idB = rule.evaluate(evidenceB)[0]?.id
  expect(idA).not.toBe(idB)
})
```

**Step 2: Run tests**

Run: `pnpm --filter @apex/ai-core test -- --run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/ai-core/src/correlation/__tests__/rules.test.ts
git commit -m "test: verify correlation IDs distinguish different shared signals"
```

---

## Task 5: Populate proposedActions in recommendation strategies

**Problem:** All strategies return `proposedActions: []`, meaning the Action layer will have nothing to work with.

**Files:**

- Modify: `packages/ai-core/src/intelligence/recommendations/strategies/AddTestingStrategy.ts`
- Modify: `packages/ai-core/src/intelligence/recommendations/strategies/AddCIStrategy.ts`
- Modify: `packages/ai-core/src/intelligence/recommendations/strategies/AddTypeScriptStrategy.ts`
- Modify: `packages/ai-core/src/intelligence/recommendations/strategies/AddressFindingStrategy.ts`

**Step 1: Add proposedActions to AddTestingStrategy**

```typescript
proposedActions: [
  {
    id: 'add-vitest',
    title: 'Add Vitest test framework',
    description: 'Configure Vitest with a baseline test suite and add to CI pipeline.',
  },
  {
    id: 'add-first-tests',
    title: 'Write baseline repository tests',
    description: 'Add 3-5 smoke tests covering critical paths to establish test coverage baseline.',
  },
],
```

**Step 2: Add proposedActions to AddCIStrategy**

```typescript
proposedActions: [
  {
    id: 'add-github-actions',
    title: 'Create GitHub Actions workflow',
    description: 'Add .github/workflows/ci.yml with lint, typecheck, test, and build steps.',
  },
],
```

**Step 3: Add proposedActions to AddTypeScriptStrategy**

```typescript
proposedActions: [
  {
    id: 'add-tsconfig',
    title: 'Add tsconfig.json',
    description: 'Configure TypeScript compiler options with strict mode enabled.',
  },
  {
    id: 'rename-to-ts',
    title: 'Rename .js files to .ts',
    description: 'Convert source files from JavaScript to TypeScript and fix type errors.',
  },
],
```

**Step 4: Add proposedActions to AddressFindingStrategy**

```typescript
proposedActions: [
  {
    id: `address-${finding.id}`,
    title: `Investigate: ${finding.title}`,
    description: `Review and address the ${finding.severity} severity ${finding.type} finding.`,
  },
],
```

**Step 5: Update tests**

In `packages/ai-core/src/intelligence/recommendations/__tests__/strategies.test.ts`, update the tests that check `proposedActions` to verify non-empty:

For each strategy test that checks `proposedActions`, change from:

```typescript
expect(Array.isArray(rec.proposedActions)).toBe(true)
```

to:

```typescript
expect(rec.proposedActions.length).toBeGreaterThan(0)
expect(rec.proposedActions[0].id).toBeDefined()
expect(rec.proposedActions[0].title).toBeDefined()
```

Also update `AddressFindingStrategy.test.ts` line 138-140:

```typescript
it('returns recommendation with proposedActions', () => {
  const rec = strategy.recommend(input)
  expect(rec.proposedActions.length).toBeGreaterThan(0)
})
```

**Step 6: Run tests**

Run: `pnpm --filter @apex/ai-core test -- --run`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/ai-core/src/intelligence/recommendations/strategies/ packages/ai-core/src/intelligence/recommendations/__tests__/
git commit -m "feat: populate proposedActions in all recommendation strategies"
```

---

## Task 6: Include evidence ID and source in serializeEvidence

**Problem:** `serializeEvidence` doesn't include evidence ID or source, making it hard for the LLM to trace provenance.

**Files:**

- Modify: `packages/prompts/src/variables/repository.ts`
- Modify: `packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts`

**Step 1: Update serializeEvidence**

```typescript
export function serializeEvidence(evidence: Evidence[]): string {
  if (evidence.length === 0) return '- No structured evidence available'
  return evidence
    .map(
      (e) =>
        `- [${e.type}] ${e.key}\n  ID: ${e.id}\n  Source: ${e.source}\n  Value: ${JSON.stringify(e.value)}`
    )
    .join('\n')
}
```

**Step 2: Update test**

In `PromptRenderer.test.ts`, update the evidence test:

```typescript
it('includes evidence ID and source in prompt', () => {
  const rendered = renderer.renderRepositoryIntelligence(mockVariables)
  expect(rendered.content).toContain('ID: testing:hasTests')
  expect(rendered.content).toContain('Source: github')
})
```

**Step 3: Run tests**

Run: `pnpm --filter @apex/prompts test -- --run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/prompts/src/variables/repository.ts packages/prompts/src/renderer/__tests__/PromptRenderer.test.ts
git commit -m "fix: include evidence ID and source in prompt serialization"
```

---

## Task 7: Document dependency direction

**Problem:** The `ai-core → prompts → analysis → contracts` dependency rule is not explicitly documented.

**Files:**

- Create or modify: `docs/architecture.md` (or wherever architecture docs live)

**Step 1: Check if architecture docs exist**

Look for existing architecture documentation in `docs/` or as a README.

**Step 2: Add dependency direction documentation**

Add a section to the architecture documentation:

```markdown
## Package Dependency Rules

The monorepo follows a strict dependency direction:
```

ai-core → prompts → analysis → contracts
ai-core → analysis
ai-core → contracts

```

**Rules:**
- `@apex/ai-core` MAY depend on `@apex/prompts`
- `@apex/prompts` MUST NEVER depend on `@apex/ai-core`
- `@apex/prompts` MAY depend on `@apex/analysis` and `@apex/contracts`
- `@apex/analysis` MUST NEVER depend on `@apex/ai-core` or `@apex/prompts`
- `@apex/contracts` has no internal dependencies (leaf package)

This ensures domain logic (`ai-core`) can use prompt rendering, but prompt rendering cannot import domain entities.
```

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: document package dependency direction rules"
```

---

## Task 8: Full test suite verification

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

---

## Summary

| #   | Issue                                               | Fix                                                           |
| --- | --------------------------------------------------- | ------------------------------------------------------------- |
| 1   | CrossSource counts all sources, not just correlated | Track `correlatedSources` set, use for sourceTypes/scoring/ID |
| 2   | ExplanationDTO drops insightIds/findingIds          | Add fields to DTO, update mapper and serializer               |
| 3   | External evidence bypasses createEvidence           | Validate at pipeline ingestion boundary                       |
| 4   | Correlation ID doesn't distinguish signals          | Include shared keys in ID (done in Task 1)                    |
| 5   | Strategies return empty proposedActions             | Add meaningful actions to all 4 strategies                    |
| 6   | serializeEvidence missing ID/source                 | Add ID and source to serialized output                        |
| 7   | Dependency direction undocumented                   | Add architecture docs with explicit rules                     |
