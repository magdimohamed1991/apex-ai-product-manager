# ADR-0001: Monorepo Architecture with Turborepo

**Date:** 2026-08-07
**Status:** Accepted

---

## Problem

APEX consists of multiple interconnected packages:

- A web application (`apps/web`)
- A shared UI library (`@apex/ui`)
- A core AI domain (`@apex/ai-core`)
- Static analysis utilities (`@apex/analysis`)
- Shared configuration (`@apex/config`, `@apex/design-tokens`)

Managing these as separate repositories would create friction: dependency versioning overhead, duplicated tooling, and difficulty making cross-cutting changes atomically.

---

## Decision

Use a **pnpm + Turborepo monorepo** with the following structure:

```
apps/       ← deployable applications
packages/   ← shared libraries and utilities
```

All packages are linked via `workspace:*` protocol. Turborepo handles caching and task orchestration.

---

## Alternatives Considered

| Option                  | Reason Rejected                                         |
| ----------------------- | ------------------------------------------------------- |
| Separate repositories   | Too much overhead for a single product                  |
| Yarn workspaces + Lerna | pnpm is faster and more reliable                        |
| Nx                      | More complex setup, Turborepo is simpler for this scale |

---

## Consequences

- ✅ Atomic changes across packages in a single commit
- ✅ Shared TypeScript configs via `@apex/config`
- ✅ No duplicated tooling (ESLint, Prettier, TypeScript)
- ✅ Easy to add new apps (mobile, admin, CLI) later
- ⚠️ Requires pnpm — contributors cannot use npm or yarn
