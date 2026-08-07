# ADR-0002: Domain-Driven Design for AI Core

**Date:** 2026-08-07
**Status:** Accepted

---

## Problem

AI agents return raw data (JSON, strings, arrays). Without a shared domain model, each agent invents its own output format, making it impossible to:

- Display insights from multiple agents uniformly
- Build cross-agent workflows
- Persist and query intelligence over time

---

## Decision

Adopt **Domain-Driven Design (DDD)** for `@apex/ai-core` with a strict layering:

```
Value Objects → Entities → Repositories → Domain Events
```

Core entities: `Workspace → Integration → Insight → Finding → Recommendation → Action`

All agents produce domain entities — never raw JSON.

---

## Alternatives Considered

| Option               | Reason Rejected                         |
| -------------------- | --------------------------------------- |
| Raw JSON outputs     | No type safety, no shared language      |
| OpenAPI schemas only | Defines wire format, not business logic |
| GraphQL types        | Not needed at this stage                |

---

## Consequences

- ✅ Agents speak a shared language — outputs are composable
- ✅ Replacing or adding agents doesn't break consumers
- ✅ Repository contracts allow swapping Supabase for any DB
- ✅ Domain events decouple agents from each other
- ⚠️ More upfront design work before writing agent logic
