# ADR-0003: Agent Architecture — Contracts, Base Class, Registry

**Date:** 2026-08-07
**Status:** Accepted

---

## Problem

As APEX grows, there will be 10+ agents (GitHub, Slack, Linear, Reviews, Amplitude...). Without a shared pattern, each agent will:

- Handle errors differently
- Log inconsistently
- Be hard to test in isolation
- Require manual wiring

---

## Decision

All agents follow a strict three-layer pattern:

1. **Contract** — `Agent<TInput, TOutput>` interface every agent implements
2. **BaseAgent** — abstract class providing timing, error handling, and telemetry hooks
3. **AgentRegistry** — central registry for registration, resolution, and execution

```
Agent<TInput, TOutput>
    ↑
BaseAgent (timing, error handling, hooks)
    ↑
RepositoryDiscoveryAgent (only implements `run()`)
```

---

## Alternatives Considered

| Option                     | Reason Rejected                           |
| -------------------------- | ----------------------------------------- |
| Standalone functions       | No shared error handling or telemetry     |
| LangChain agents           | Adds heavy dependency, hides domain model |
| Direct class instantiation | No centralized registry or DI             |

---

## Consequences

- ✅ Every agent is consistent — same error format, same timing
- ✅ Easy to add logging/telemetry to all agents at once via BaseAgent
- ✅ AgentRegistry enables future feature flags and versioning
- ✅ Agents are independently testable (input → output)
- ⚠️ Slightly more boilerplate per agent than a plain function
