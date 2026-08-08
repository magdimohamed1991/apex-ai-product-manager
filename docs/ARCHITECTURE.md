# APEX Architecture

## Monorepo Structure

```
apex-ai-product-manager/
├── packages/
│   ├── contracts/      @apex/contracts      Canonical types, DTOs, enums
│   ├── analysis/       @apex/analysis       Static analysis, evidence collection, rules
│   ├── ai-core/        @apex/ai-core        Domain entities, agents, intelligence pipeline
│   ├── prompts/        @apex/prompts        Prompt builders (→ contracts + analysis only)
│   ├── config/         @apex/config         Shared configuration
│   ├── shared/         @apex/shared         (scaffold — not yet populated)
│   ├── design-tokens/  @apex/design-tokens  Design tokens
│   └── ui/             @apex/ui             React component library
└── apps/
    └── web/            @apex/web            Dashboard (React/Vite)
```

## Package Dependency Rules

The monorepo follows a strict dependency direction:

```
ai-core → prompts → analysis → contracts
ai-core → analysis
ai-core → contracts
```

### Rules

- `@apex/ai-core` MAY depend on `@apex/prompts`
- `@apex/prompts` MUST NEVER depend on `@apex/ai-core`
- `@apex/prompts` MAY depend on `@apex/analysis` and `@apex/contracts`
- `@apex/analysis` MUST NEVER depend on `@apex/ai-core` or `@apex/prompts`
- `@apex/contracts` has no internal dependencies (leaf package)

### Rationale

This ensures domain logic (`ai-core`) can use prompt rendering, but prompt rendering cannot import domain entities. The `prompts` package is limited to prompt construction and rendering — it has access to contract types (DTOs, enums) and analysis utilities (evidence, rules) but never reaches into domain entities, agents, or pipeline orchestration. This keeps prompt logic independently testable and prevents circular dependencies.

## Domain Model

All domain entities live in `@apex/ai-core/src/domain/entities/`:

| Entity           | Purpose                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| `Insight`        | Static analysis signal (from RuleEngine)                                           |
| `Finding`        | Actionable problem (from CorrelationEngine only — see Architecture Decision below) |
| `Recommendation` | Strategy-generated proposal (from Insight or Finding)                              |
| `Explanation`    | Provenance chain for Insights and Findings                                         |
| `Action`         | Execution record (not yet wired)                                                   |
| `Workspace`      | Tenant boundary                                                                    |

## Data Flow: Repository Discovery Pipeline

```
RepositoryFiles
    ↓
StaticRepositoryAnalyzer → RepositorySummary
    ↓
EvidenceCollector → Evidence[]
    ↓
RuleEngine → RuleResult[]
    ↓
InsightMapper + ExplanationBuilder → Insight[] + Explanation[]
    ↓
CorrelationEngine → CorrelationCandidate[]
    ↓
CorrelationFindingBuilder → Finding[] + Explanation[]
    ↓
RecommendationEngine → Recommendation[]
    ↓
PipelineResult { summary, evidence, insights, findings, explanations, recommendations }
```

## Agent Architecture

### RepositoryDiscoveryAgent

Thin orchestrator over `RepositoryDiscoveryPipeline`. No LLM. Pure static analysis.

- **Input:** `PipelineInput { workspaceId, files }`
- **Output:** `PipelineResult` (full pipeline output)

### RepositoryIntelligenceAgent

LLM-powered agent for executive engineering assessment.

- **Input:** `RepositoryAssessmentRequest` (pre-assembled pipeline output + workspace)
- **Output:** `RepositoryAssessmentEntity` (executive summary, risks, priorities)
- **Prompt path:** `PromptRegistry → PromptRenderer → versioned prompt string → LLMProvider`
  No inline prompt building in the agent. `@apex/prompts` is the single canonical prompt source.
- **Input consumed:** repository summary, evidence, insights, findings, recommendations, explanations

### BaseAgent

Abstract base providing timing, error handling, and telemetry hooks. Subclasses implement `run()`.

### AgentRegistry

Singleton registry for agent registration, resolution, and execution.

## Architecture Decision: Finding Origin

**Current implementation:** Findings originate exclusively from the CorrelationEngine.

```
Insight ──────────────────────────────→ Recommendation (direct)
Evidence → Correlation → Finding ────→ Recommendation
```

The `Finding.relatedInsights` field is reserved for a future `Insight → Finding` path
but is not populated by any current pipeline stage. Insights generate Recommendations
directly. This decision avoids building machinery for a path with no current consumer.

**Future:** If a use case requires `Insight → Finding → Recommendation` (e.g., grouping
multiple insights into a single compound finding), populate `relatedInsights` at that time
and update this section.

## Recommendation Strategies

Each strategy declares `supportedOrigins` and operates on `RecommendationInput`:

| Strategy                 | Origin    | Matches             |
| ------------------------ | --------- | ------------------- |
| `AddTestingStrategy`     | `insight` | `no-tests` tag      |
| `AddCIStrategy`          | `insight` | `no-ci` tag         |
| `AddTypeScriptStrategy`  | `insight` | `no-typescript` tag |
| `AddressFindingStrategy` | `finding` | Any Finding         |

### Provenance Chain

Every `Recommendation` carries:

- `origin`: `'insight'` or `'finding'`
- `insightIds[]`: Source insight(s)
- `findingIds[]`: Source finding(s)
- `deduplicationKey`: `${strategyId}:${origin}:${sourceEntityId}`

The engine deduplicates by tracking seen keys per `generate()` call.

> **Deduplication scope:** Per-run only. The engine does NOT persist deduplication state across calls. Global/persistent deduplication belongs to the repository/persistence layer.

## Canonical Source Types

Defined in `@apex/contracts`:

```typescript
type SourceType =
  'github' | 'slack' | 'linear' | 'jira' | 'amplitude' | 'google_play' | 'app_store' | 'website'
```

**Not** dashed forms (`google-play`). Always underscores.

## Testing

- **313 tests** across 3 packages (ai-core: 263, analysis: 36, prompts: 14)
- Contract → Tests → Implementation (never reverse)
- Provenance assertions: `Finding.evidenceIds === Explanation.evidenceIds`
- Deduplication assertions: same `deduplicationKey` → engine keeps first
