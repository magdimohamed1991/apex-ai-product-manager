# APEX Agents

This document describes the **actual** agent layer in the codebase as
of the Milestone I production-hardening pass.

## Implemented

### `RepositoryDiscoveryAgent`

A thin orchestrator over `RepositoryDiscoveryPipeline`. No LLM. Pure
static analysis.

- **Input:** `PipelineInput { workspaceId, files }`
- **Output:** `PipelineResult` (summary, evidence, insights, findings,
  explanations, recommendations)

### `RepositoryIntelligenceAgent`

LLM-powered agent for executive engineering assessment. Honors the
H4 contract (system instructions + structured output + grounding
check).

- **Input:** `RepositoryAssessmentRequest` (pre-assembled pipeline
  output + workspace)
- **Output:** `RepositoryAssessmentEntity` (executive summary, risks,
  priorities)
- **Prompt path:** `PromptRegistry → PromptRenderer → versioned prompt
string → LLMProvider`. No inline prompt building in the agent.
- **Behavior on invalid LLM output:** the agent retries within the
  `BudgetPolicy.maxAttempts` budget and, on terminal failure, throws a
  hard error — pipeline execution terminates immediately and **no
  fabricated facts are produced or persisted** (see
  `docs/ARCHITECTURE.md`, "LLM Validation and Retry Terminal Failure
  Contract").
- **Production guard:** the budget-based fallback to `MockLLMProvider`
  throws `SecurityError` when `NODE_ENV=production` — a mock assessment
  is never produced in production.

## Contract

The agent layer is intentionally thin. Real domain work lives in
application services (`APEXProductService`, `ActionExecutor`,
`AdaptiveProfileCompiler`, etc.). Agents compose those services and
add the LLM-call boundary.

## Mock LLM Provider

The `MockLLMProvider` is **test-only**. It returns a deterministic
JSON string. Production code paths must inject the
`OpenAIResponsesProvider` (or another real provider) explicitly.

## Prompt Source of Truth

All prompts are built via `@apex/prompts`. The package depends only
on `@apex/analysis` and `@apex/contracts`, never on `@apex/ai-core`.
This is enforced by the workspace package graph.
