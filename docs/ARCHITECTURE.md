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

### Priority vs. Severity Semantics

To prevent interchangeably using Priority and Severity during domain translation:

- **Severity**: Measures **how serious the underlying problem is** (critical, high, medium, low, info) from a technical adoption, vulnerability, or performance perspective.
- **Priority**: Measures **how urgently the organization should act** (critical, high, medium, low) taking into account business risk, engineering capacity, and dependencies.

While high-severity items typically warrant high priority, low-severity items (e.g., small config optimization) can sometimes be high priority if they unblock a critical deployment pathway.

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

### LLM Validation and Retry Terminal Failure Contract

To prevent corrupted downstream data and partial generation states:

- **No Partial Downstream States:** If the LLM response fails validation (malformed JSON or violated schema constraints) and exceeds the maximum retry budget (default: 3 attempts), the agent **always throws a hard ValidationError** and terminates pipeline execution immediately.
- **Fail Fast:** No partial or corrupt Recommendations or Actions are ever persisted or created on terminal LLM failure.

### AgentRegistry

Singleton registry for agent registration, resolution, and execution.

## Architecture Decision: Finding Origin

**Current implementation:** Findings originate exclusively from the CorrelationEngine.

```
Insight ──────────────────────────────→ Recommendation (direct)
Evidence → Correlation → Finding ────→ Recommendation
```

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

- Tests are distributed across ai-core, analysis, and prompts, with CI enforcing the complete suite.
- Contract → Tests → Implementation (never reverse)
- Provenance assertions: `Finding.evidenceIds === Explanation.evidenceIds`
- Deduplication assertions: same `deduplicationKey` → engine keeps first

## Actions and Execution Semantics (Step 2C Foundation)

### ProposedAction vs Action Semantics

To establish a clear boundary before Step 2C, we define:

1. **ProposedAction**: An AI-generated recommended task, packaged as a readonly metadata record attached to a `Recommendation` (e.g. "Add Vitest configuration"). It has no state machine or connection target of its own.
2. **Action**: An accepted, tracked unit of executable work inside a Workspace. It has a state machine, a connection target (e.g. GitHub or Jira), and tracks external identifiers.

**Data Flow:**
`Recommendation → ProposedAction → [Approval / Conversion Interface] → Action → External Execution`

### ProposedAction → Action Mapping Contract

When converting a `ProposedAction` into an `Action`, the following mapping rules apply:

- **Default Target:** Actions are initialized with target `internal` by default.
- **Export Targets:** Supported targets include `github`, `jira`, `linear`, `slack`. When an export is triggered, the Action's `externalId` is populated with the ID returned by the external system.
- **Unsupported/Mismatched Targets:** If a specific execution target is requested but the respective Integration/Source is not connected or fails, the Action falls back to `internal` as a tracked, workspace-local item.

### Action Lifecycle and Status Semantics

Actions function as both PM tasks and execution jobs. The Action lifecycle transitions through the following statuses:

- `proposed` (default state upon Recommendation generation, before user approval)
- `approved` (user has approved the action, queued for export/execution)
- `queued` (export request is being pushed to Jira/GitHub or execution job is scheduled)
- `in-progress` (external ticket is active or code-generation execution job is running)
- `completed` (external ticket is marked Done or code-fix execution completed successfully)
- `failed` (export or code-execution failed; allows retry or fallback)

## Milestone E & F — Action Application & Execution Reliability Architecture

### End-to-End Execution Flow

The APEX execution system coordinates the lifecycle from raw files to resilient side-effects:

```
Discovery Pipeline
       │
       ▼
PipelineActionOrchestrator
       │
       ▼
ActionApplicationService
       │
       ▼
ActionRepository (Durable Relational Storage Engine)
       │
       ▼
ActionExecutionWorker (Discovery & Polling Loops)
       │
       ▼
ActionExecutor (Atomicity & Retry Controller)
       │
       ▼
AdapterRegistry
   ┌───┼────┬────┐
   ▼   ▼    ▼    ▼
GitHub Jira Linear Slack
       │
       ▼
External System
```

### Key Architectural Contracts Enforced

1. **Promotion Idempotency**:
   The logical promotion identity is bound to `promo:${workspaceId}:${recommendationId}:${proposedActionId}`. Repeating the pipeline multiple times creates exactly zero duplicate Action records.
2. **Execution Idempotency**:
   The external side-effect is mapped directly to `Action.idempotencyKey` as the stable external correlation key. If a worker crashes mid-run, retries perform **Query-before-Create** lookups to recover the existing issue/ticket without opening duplicates.
3. **Lease Crash Recovery**:
   When background workers claim Actions via `claimForExecution()`, any expired active leases (abandoned or crashed worker states) are recovered. The previous execution attempt is reconciled as `failed` due to `timeout` before the new claim begins.
4. **Stale Worker Protection**:
   `persistExecutionOutcome()` validates lease ownership. If a stale worker tries to persist state after a lease expiration takeover, the save is rejected.
5. **Durable Retry Scheduling**:
   Transient errors calculate exponential backoffs, persisting **`nextAttemptAt`** in the repository. Retry schedules fully survive process terminations.
6. **Multi-Tenant Security Matrix**:
   Strict `(id, workspaceId)` double-key isolation is enforced across every single repository query. GUESSING Action IDs never crosses tenant bounds.
7. **Secrets Redaction Safeguards**:
   All logs, errors, and metadata are swept recursively by `redactSensitiveData()` to protect OAuth tokens, Bearer keys, or passwords from leaking.

## Milestone H6 — Adaptive Product Intelligence

### H6 Invariant (The H6 Golden Rule)

**Adaptive learning is advisory, deterministic, evidence-derived, tenant-scoped, and non-destructive. H6 may influence future prioritization but must never mutate historical H3 scores, H4 reasoning records, H5 outcomes, or underlying repository facts.**

### Calibration Provenance Data Flow

Every prioritization calibration computed by H6 is fully inspectable, auditable, and traceable through the following mathematical progression:

```
  H3 Base Priority Score (Deterministic Rules)
            ↓
  H6 Category Adoption Signals (Based on N Historical Observations)
            ↓
  H6 Outcome Verification Success Rates
            ↓
  Statistical Safeguards & Confidence Constraints (n / (n + 10))
            ↓
  Objective Risk Enforced Safety Floor (Never deflated below 8.5 for Critical/7.0 for High)
            ↓
  Final Calibrated Priority Score
```
