# ADR-0005: Feature-First Frontend Architecture

**Date:** 2026-08-07
**Status:** Accepted

---

## Problem

The default React project structure organizes code by file type:

```
components/
hooks/
utils/
pages/
```

This works for small apps but breaks down as the product grows — related code gets scattered across multiple directories, making it hard to understand or modify a feature in isolation.

Additionally, using `src/app/` would conflict with Next.js App Router naming if the project migrates in the future.

---

## Decision

Use **Feature-First Architecture** with `src/features/`:

```
src/
  features/
    onboarding/
      steps/        ← step components
      shared/       ← shared UI within this feature
      hooks/        ← feature-specific hooks
      types.ts
      constants.ts
      page.tsx
    dashboard/
      page.tsx
```

Each feature is a self-contained module. Cross-feature dependencies go through shared packages (`@apex/ui`, `@apex/ai-core`).

---

## Alternatives Considered

| Option                               | Reason Rejected                          |
| ------------------------------------ | ---------------------------------------- |
| `src/app/`                           | Conflicts with Next.js App Router naming |
| Type-based (`components/`, `hooks/`) | Related code is scattered                |
| Atomic Design                        | Over-engineered for this product type    |

---

## Consequences

- ✅ Adding a new feature = adding a new folder
- ✅ Deleting a feature = deleting one folder
- ✅ No naming conflict with Next.js if we migrate later
- ✅ Clear ownership — each feature team owns its folder
- ⚠️ Shared components must be explicitly moved to `@apex/ui`
