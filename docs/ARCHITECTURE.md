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

## Dependency Direction

```
contracts ← analysis ← ai-core ← web
                ↑
            prompts → contracts + analysis
```

**Hard rule:** `prompts` never imports from `ai-core`.

## Domain Model

All domain entities live in `@apex/ai-core/src/domain/entities/`:

| Entity           | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `Insight`        | Static analysis signal (from RuleEngine)               |
| `Finding`        | Actionable problem (from CorrelationEngine or Insight) |
| `Recommendation` | Strategy-generated proposal (from Insight or Finding)  |
| `Explanation`    | Provenance chain for Insights and Findings             |
| `Action`         | Execution record (not yet wired)                       |
| `Workspace`      | Tenant boundary                                        |

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

### BaseAgent

Abstract base providing timing, error handling, and telemetry hooks. Subclasses implement `run()`.

### AgentRegistry

Singleton registry for agent registration, resolution, and execution.

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

## Canonical Source Types

Defined in `@apex/contracts`:

```typescript
type SourceType =
  'google_play' | 'app_store' | 'amplitude' | 'github' | 'testflight' | 'firebase' | 'play_console'
```

**Not** dashed forms (`google-play`). Always underscores.

## Testing

- **299 tests** across 3 packages (ai-core: 249, analysis: 36, prompts: 14)
- Contract → Tests → Implementation (never reverse)
- Provenance assertions: `Finding.evidenceIds === Explanation.evidenceIds`
- Deduplication assertions: same `deduplicationKey` → engine keeps first
