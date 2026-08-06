# @apex/ai-core — Product Intelligence Platform

The core domain model and agent infrastructure for APEX.

---

## Architecture

```
ai-core/
  domain/           ← Entities, Value Objects, Repositories, Services, Events
  agents/           ← Individual AI agents (GitHub, Slack, Linear, Reviews...)
  workflows/        ← Multi-agent orchestration pipelines
  memory/           ← Product Memory — decisions, history, metrics, experiments
  providers/        ← LLM provider abstraction (OpenAI, Anthropic, Gemini, Local)
  tools/            ← Agent tools (search, read, summarize, classify, embed)
  types/            ← Shared TypeScript interfaces
```

---

## Core Domain Entities

| Entity        | Description                                |
| ------------- | ------------------------------------------ |
| `Workspace`   | Represents the entire product              |
| `Integration` | GitHub, Slack, Linear, Jira, Amplitude...  |
| `Insight`     | Any piece of intelligence discovered by AI |
| `Finding`     | Bug, Opportunity, Risk, or Growth signal   |
| `Task`        | Any action recommended by AI               |
| `Roadmap`     | Quarterly, Monthly, Weekly planning        |
| `Feature`     | Product feature with status and priority   |
| `Issue`       | Bug or problem from any source             |
| `Feedback`    | User feedback from reviews or surveys      |
| `Experiment`  | A/B test or growth experiment              |
| `Metric`      | Conversion, Retention, Activation, Revenue |

---

## Design Principles

1. Agents talk to Domain Entities, never raw JSON
2. Providers are swappable — agents never import OpenAI directly
3. Memory is persistent and structured — not just chat history
4. Workflows orchestrate agents, not the other way around
5. Tools are composable and reusable across agents

---

## Agent Output Contract

Every agent produces structured domain objects:

```
Input: Integration (GitHub URL)
       ↓
Agent: Repository Discovery Agent
       ↓
Output: Workspace → Feature[] → Issue[] → Insight[] → Task[]
```
