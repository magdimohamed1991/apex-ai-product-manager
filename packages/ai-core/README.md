# @apex/ai-core — Product Intelligence Platform

The core domain model and agent infrastructure for APEX.

---

## Architecture

```
ai-core/
  domain/
    value-objects/    ← WorkspaceId, Priority, Severity, Status...
    entities/         ← Workspace, Integration, Insight, Finding, Recommendation, Action
    repositories/     ← Persistence contracts (Supabase / Postgres / Mock)
    events/           ← Domain events emitted by agents and workflows
  agents/             ← Individual AI agents (GitHub, Slack, Linear, Reviews...)
  workflows/          ← Multi-agent orchestration pipelines
  memory/             ← Product Memory — decisions, history, metrics
  providers/          ← LLM abstraction (OpenAI, Anthropic, Gemini, Local)
  tools/              ← Composable agent tools (search, read, summarize, embed)
  types/              ← Legacy shared interfaces
```

---

## Domain Pipeline

```
Workspace
    │
    ▼
Integration  (GitHub / Slack / Linear / Amplitude...)
    │
    ▼
Raw Data
    │
    ▼
Insight      (observation — agent-agnostic)
    │
    ▼
Finding      (actionable signal: bug / opportunity / risk / growth)
    │
    ▼
Recommendation  (what to do + why + effort + impact)
    │
    ▼
Action          (internal task or exported to Jira / Linear / GitHub)
    │
    ▼
Roadmap
```

---

## Core Domain Entities

| Entity           | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `Workspace`      | Represents the entire product                             |
| `Integration`    | GitHub, Slack, Linear, Jira, Amplitude...                 |
| `Insight`        | Any intelligence discovered by AI — source-agnostic       |
| `Finding`        | Actionable signal: bug, opportunity, risk, or growth      |
| `Recommendation` | What to do, why, effort, and impact                       |
| `Action`         | Internal task or external export (Jira / Linear / GitHub) |

---

## Value Objects

| Value Object      | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `WorkspaceId`     | Branded ID — prevents mixing IDs                             |
| `WorkspaceName`   | Validated name (non-empty, max 100 chars)                    |
| `WorkspaceSlug`   | URL-safe slug derived from name                              |
| `WorkspaceType`   | saas / mobile-app / marketplace / ai-product / internal-tool |
| `IntegrationType` | github / linear / jira / slack / amplitude...                |
| `Priority`        | critical / high / medium / low                               |
| `Severity`        | critical / high / medium / low / info                        |
| `MetricType`      | conversion / retention / activation / revenue...             |
| `Status`          | Workspace / Integration / Task / Roadmap status              |

---

## Repository Contracts

All repositories are interfaces — implementations are injected:

```ts
// Any of these can implement WorkspaceRepository:
class SupabaseWorkspaceRepository implements WorkspaceRepository {}
class PostgresWorkspaceRepository implements WorkspaceRepository {}
class InMemoryWorkspaceRepository implements WorkspaceRepository {}
```

---

## Design Principles

1. Agents talk to Domain Entities, never raw JSON
2. Providers are swappable — agents never import OpenAI directly
3. Memory is persistent and structured — not just chat history
4. Workflows orchestrate agents, not the other way around
5. Tools are composable and reusable across agents
6. Events decouple agents from each other
