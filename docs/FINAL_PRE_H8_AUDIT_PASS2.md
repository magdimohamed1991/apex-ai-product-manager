# APEX — Final Pre-H8 Exhaustive Audit & Remediation (Pass 2)

**Date:** 2026-08-10
**Branch:** `arena/019fea5a-apex-ai-product-manager`
**Base:** `b6013aa` (PR #6 merge into `main`)
**Scope:** Independent re-verification of the entire H1–H7 engineering surface from source, tests, build, and a live HTTP runtime — without trusting the prior reports.

> This document **supersedes** `docs/FINAL_PRE_H8_AUDIT.md` for the _current_
> tree state. The prior reports are retained unchanged as historical snapshots
> (Phase 13: historical documents are not rewritten). Where a prior "residual
> issue" is now resolved in code, it is called out explicitly below.

---

## 1. Executive Summary

I inspected the full monorepo (`packages/ai-core`, `packages/analysis`,
`packages/prompts`, `packages/contracts`, `packages/ui`, `apps/web`), the API
composition root, every persistence adapter, the auth/authz boundary, the
H6/H7 causal loop, the durable database engine, the CI workflow, and the
frontend. I ran the complete local CI-equivalent gate, a live end-to-end HTTP
walkthrough, and a direct durable-database inspection.

The codebase is in strong shape. The prior H7 remediation was, on independent
verification, substantially correct — **with one exception that this pass found
and fixed**: three project-owned entity upserts (`Recommendation`, `Finding`,
`RecommendationOutcome`) were keyed on `(id, workspaceId)` rather than
`(id, workspaceId, projectId)`, so two projects in the **same workspace**
sharing a resource id would silently **clobber** each other — a direct
violation of Phase-3 Scenario A/B. This was proven with a failing test, fixed,
and re-proven green. Two prior "residual" notes (UI-only-ACCEPT and the
confidence-bucket mixing populations) were also independently confirmed to be
**already resolved** in the current code; the prior report's residual table is
stale on those two points.

No frozen-core file was modified (verified byte-for-byte). All gates pass.
GitHub Actions remains blocked by an external billing lock — explicitly _not_
an application defect.

---

## 2. Findings

### F1 — Cross-project upsert clobber (Recommendation / Finding / Outcome)

- **ID:** F1
- **Severity:** MEDIUM (latent isolation-contract gap; not actively exploitable with current id generation, but violates the explicit Phase-3 invariant and becomes exploitable if id generation ever changes)
- **Area:** Persistence integrity / project isolation
- **Evidence:** `SqlProductRepository.saveRecommendation` and `.saveFinding`, and `SqlRecommendationOutcomeRepository.save` filtered their upsert on `(id, workspaceId)` only. The `projectId` was stored on the row but **not** part of the delete key. A failing probe (`PROBE proj-a count: 0, proj-b count: 1`) proved project B overwrote project A's same-id recommendation in the same workspace. The telemetry upsert was already correctly keyed on `(id, workspaceId, projectId)` — these three were the inconsistent ones.
- **Impact:** Two projects tracking the same codebase (or any future id scheme producing a colliding id) could lose each other's persisted rows. Today's id generation makes insight-based rec ids project-unique (`ins-{ws}-{projectId}-{ruleId}`) and finding-based rec/finding ids random (`crypto.randomUUID()`), so collisions are improbable in practice — but the **contract** did not guarantee coexistence, which is exactly what Phase 3 requires.
- **Fix:** Re-keyed all three upserts on `(id, workspaceId, projectId)`, matching the telemetry upsert's belt-and-braces guarantee. Cast to the stored (`projectId`-carrying) types in the filter, exactly as the read paths already do.
  - `packages/ai-core/src/infrastructure/repositories/SqlProductRepository.ts` (`saveRecommendation`, `saveFinding`)
  - `packages/ai-core/src/infrastructure/repositories/SqlRecommendationOutcomeRepository.ts` (`save`)
- **Tests:** `CrossProjectCollision.test.ts` (5 tests: recommendations, findings, telemetry, outcomes, signals/profiles coexistence) + `CrossProjectServiceIsolation.test.ts` (1 end-to-end test: two projects analyzing the same repo in one workspace keep independent data). All green. The full existing suite (624 ai-core tests) still passes — the change is strictly additive in isolation strength.

### F2 — Action-scoped endpoints absent from the 403 sweep

- **ID:** F2
- **Severity:** LOW (defense-in-depth test gap; endpoints were already protected by `authenticateAndAuthorize` membership checks, but the substitution attack was untested)
- **Area:** API authorization matrix / test coverage
- **Evidence:** The existing 14-route ID-substitution sweep covered every project-scoped resource but omitted the workspace-scoped action routes `GET /api/actions/:id` and `GET /api/actions/:id/executions`.
- **Impact:** A regression weakening the membership check on those routes would have gone undetected.
- **Fix:** Added `denies cross-workspace access on action-scoped endpoints` to `api-server.test.ts` — proves cross-workspace substitution → 403, own-workspace + foreign actionId → 404 (no existence leak), and owner access → 200.
- **Tests:** 1 new test in `api-server.test.ts` (web suite 18 → 19).

### F3 — Stale residual claims in the prior audit

- **ID:** F3
- **Severity:** INFO (documentation accuracy)
- **Area:** Documentation consistency
- **Evidence:** `docs/FINAL_PRE_H8_AUDIT.md` residual table lists two issues as open that are **already resolved** in current `main`:
  1. "H7 UI captures only ACCEPT decisions" — **FALSE now**: `RecommendationsPanel.tsx` renders all four decision buttons (ACCEPT/REJECT/DEFER/OVERRIDE) and records real telemetry for each, including numeric OVERRIDE priority.
  2. "H7 confidence bucket N counts recommendations + outcomes + terminal actions" — **FALSE now**: `ProductValidationService.evaluatePMValue` classifies the confidence bucket from `decisionCount` (PM-decision telemetry population) only.
- **Impact:** A future reader could believe the UI is ACCEPT-only or that the confidence bucket is contaminated.
- **Fix:** This document records both as resolved. The historical report is left intact (Phase 13) and labelled as a prior snapshot.

---

## 3. Project Isolation Matrix

Every project-owned entity, verified from source (`Sql*Repository`), with write/read keys and regression-test coverage.

| Entity                          | Write scope (upsert delete-key)                  | Read scope (filter)                             | Service-enforced                             | API-enforced                | Regression test                                                |
| ------------------------------- | ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| Project                         | `(id, workspaceId)`                              | `(id, workspaceId)` / `(workspaceId)`           | `createProject`                              | membership                  | `SqlProductRepository.test`                                    |
| RepositoryConnection            | `(id, workspaceId)`                              | `(projectId, workspaceId)`                      | `connectRepository`                          | membership                  | api-server + E2E                                               |
| PipelineRun                     | `(id, workspaceId)`                              | `(projectId, workspaceId)`                      | `runAnalysis`                                | membership                  | audit + E2E                                                    |
| Finding                         | **`(id, workspaceId, projectId)`** ✅ (F1 fix)   | `(projectId, workspaceId)`                      | `saveFinding`                                | membership                  | `CrossProjectCollision` ✅                                     |
| Recommendation                  | **`(id, workspaceId, projectId)`** ✅ (F1 fix)   | `(projectId, workspaceId)`                      | `saveRecommendation`                         | membership                  | `CrossProjectCollision` ✅ + `CrossProjectServiceIsolation` ✅ |
| AIReasoning                     | `(recommendationId, workspaceId)`                | `(recommendationId, workspaceId)`               | `saveAIProductReasoning`                     | membership                  | api-server                                                     |
| RecommendationOutcome           | **`(id, workspaceId, projectId)`** ✅ (F1 fix)   | `(projectId, workspaceId)`                      | `createOutcome` (+ rec-in-project check)     | membership + rec-in-project | `CrossProjectCollision` ✅ + audit test                        |
| PMDecisionTelemetry             | `(id, workspaceId, projectId)` (already correct) | `(projectId, workspaceId)`                      | `recordPMDecision` (+ project+rec ownership) | membership + project + rec  | api-server + `PMDecisionTelemetryService.test`                 |
| LearningSignal                  | `(workspaceId, projectId, category, type)`       | `(workspaceId, projectId)`                      | compiler                                     | membership                  | `CrossProjectCollision` ✅                                     |
| AdaptiveLearningProfile         | `(workspaceId, projectId)`                       | `(workspaceId, projectId)`                      | `getAdaptiveProfile`                         | membership                  | `CrossProjectCollision` ✅                                     |
| Action / Execution / Transition | `(id, workspaceId)` (frozen interface)           | `(id, workspaceId)` / `(actionId, workspaceId)` | `getAction`/`getExecutions`                  | membership (F2 test)        | `SqlActionRepository.test` + api-server (F2)                   |

All project-owned entities now guarantee Phase-3 coexistence (Scenario A/B).

---

## 4. API Authorization Matrix

Verified against `apps/web/src/api-server.ts` and the live 403 sweep + new
action-endpoint test + E2E. `authenticateAndAuthorize` enforces a valid
non-expired session **and** membership of the requested `workspaceId` (server-
side only; never relies on route params or the client). Project ownership is
then independently enforced in the service layer for the mutating/sensitive
paths (approve, telemetry, outcome-create, calibration).

| Route                                                                                                                        | Auth                 | Workspace  | Project               | Resource            | Test                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------- | --------------------- | ------------------- | --------------------------------------- |
| `POST /api/auth/signup`                                                                                                      | public, rate-limited | —          | —                     | —                   | api-server + AuthService                |
| `POST /api/auth/login`                                                                                                       | public, rate-limited | —          | —                     | —                   | api-server + AuthService                |
| `POST /api/auth/logout`                                                                                                      | token                | —          | —                     | session delete      | api-server                              |
| `GET /api/auth/session`                                                                                                      | token                | —          | —                     | —                   | api-server                              |
| `GET/POST /api/workspaces`                                                                                                   | token                | membership | —                     | —                   | api-server + E2E                        |
| `GET/POST /api/projects`                                                                                                     | token                | membership | —                     | id server-generated | 403 sweep + E2E                         |
| `GET/POST /api/projects/:id/repository`                                                                                      | token                | membership | yes                   | —                   | 403 sweep + E2E                         |
| `POST /api/projects/:id/analysis`                                                                                            | token                | membership | yes                   | —                   | api-server + E2E                        |
| `GET /api/projects/:id/{findings,recommendations,activity,decision-metrics,outcomes,profile,learning-signals,product-value}` | token                | membership | yes (read filter)     | —                   | 403 sweep (14 routes)                   |
| `POST /api/projects/:id/decision-telemetry`                                                                                  | token                | membership | project+rec ownership | reject impossible   | api-server (kinds+ownership+timestamps) |
| `POST /api/projects/:id/compile-profile`                                                                                     | token                | membership | yes                   | —                   | E2E                                     |
| `GET /api/recommendations/:id/calibration`                                                                                   | token                | membership | rec-in-project        | —                   | 403 sweep + audit test                  |
| `GET/POST /api/recommendations/:id/reasoning`                                                                                | token                | membership | —                     | 404 if missing      | api-server                              |
| `POST /api/actions/approve`                                                                                                  | token                | membership | rec-in-project        | idempotent          | api-server + E2E                        |
| `GET /api/actions/:id`                                                                                                       | token                | membership | —                     | scoped lookup       | **F2 test** ✅                          |
| `GET /api/actions/:id/executions`                                                                                            | token                | membership | —                     | scoped lookup       | **F2 test** ✅                          |
| `POST /api/outcomes/create`                                                                                                  | token                | membership | rec-in-project        | —                   | audit test + E2E                        |
| `POST /api/outcomes/verify`                                                                                                  | token                | membership | via outcome           | —                   | E2E                                     |

**Security contract decision (Scenario C/D):** wrong workspace → **403**
(membership denied — we do not helpfully distinguish "exists elsewhere");
non-existent / cross-project resource → **404** (scoped lookup returns nothing;
existence is not leaked). Verified live in Phase 15/16.

---

## 5. H7 → H6 Causal Loop Proof

The loop is **real and end-to-end testable** — telemetry is not merely stored:

```
PM decision (ACCEPT/REJECT/DEFER/OVERRIDE + window + optional PM priority)
   └─▶ PMDecisionTelemetryService.recordDecision
         deterministic id = sha256(workspace | project | rec | decisionStartedAt)
         strict domain validation; idempotent on identical window
   └─▶ persisted PMDecisionTelemetry (project-scoped)
         └─▶ AdaptiveProfileCompiler.compileProfile
               reads telemetry by (projectId, workspaceId)
               emits ACCEPTANCE/REJECTION/DEFER/OVERRIDE/PRIORITY_OVERRIDE_DELTA/
                   DECISION_LATENCY signals (identity over full population)
         └─▶ AdaptiveLearningProfile.categoryCoefficients (pmCalibrationWeight)
         └─▶ H6PrioritizationCalibrator.calibrate
               valence = acceptRate − rejectRate
               ambiguity = 0.5·overrideRate + 0.5·clamp((|delta|−1)/4)
               decisionAdjustment = valence · 0.30 · confidence · (1−ambiguity)
               overrideDeltaAdjustment = clamp(signedDelta/5) · 0.10 · confidence
               preferenceMultiplier = clamp(coef + Δ + Δδ, 0.85, 1.15)
               └─▶ calibratedScore → new prioritization
```

**Proof:** `H7LearningEffect.test.ts` (16 tests: strong accept, systematic
reject, systematic override, mixed 40/30/20/10, insufficient evidence N<5,
boundary N=4/5/19/20, contradictory signals, DECISION_LATENCY observational-
only, safety floors) + `H6ExtremeMatrix.test.ts` (6 tests: N=0/1/4/5/19/20/100/
1000/100000, adoption 0–100%, bounds). **Changing genuine telemetry measurably
changes the calibrated multiplier**, bounded to **[0.85, 1.15]**, with critical
(≥8.5) and high (≥7.0) safety floors that no telemetry can erase. Confidence is
the bounded operational heuristic **n/(n+10)** over the complete PM-decision
population — explicitly **not** a statistical-significance claim. 22/22 pass.

---

## 6. Fabrication / Mock-Downgrade Audit

| Location                                                        | When                               | Why                          | Production                                                    | Dev/Test                             | Coverage                       |
| --------------------------------------------------------------- | ---------------------------------- | ---------------------------- | ------------------------------------------------------------- | ------------------------------------ | ------------------------------ |
| `DevReasoningMockProvider` (api-server)                         | no `OPENAI_API_KEY`                | exercise H4 pipeline w/o key | **hard `SecurityError` refuse-to-start**                      | canned grounded reasoning            | api-server (prod refuse test)  |
| `MockLLMProvider` budget fallback (RepositoryIntelligenceAgent) | budget exceeded                    | cost guard                   | **throws in production**                                      | mock                                 | BudgetPolicy.test              |
| `runAnalysis` local scan fallback                               | clone skipped/failed               | dev convenience              | **`SecurityError` if production && !cloned && !our-monorepo** | all-false simulation (deterministic) | audit test (prod refuse) + E2E |
| credential token classification                                 | `^(ghp_\|github_pat_\|...)` prefix | real vs mock token           | real clone only for real PAT prefix                           | mock token → local scan              | E2E                            |
| GitHubAdapter mock state                                        | `resetMockState`                   | isolated tests               | —                                                             | test-only                            | adapter tests                  |
| `buildRichRecommendationFromPersisted`                          | missing H3 decoration              | never invent LLM input       | returns **null** → typed "reasoning unavailable"              | same                                 | api-server                     |

No production path silently downgrades to a mock, fake, or fabricated value.
Every "fallback" is production-guarded with an explicit hard failure. **No
hard-coded scores, no `|| 5`/`?? 5` defaults, no `Math.random` in production
code** (only in comments explaining why it is _not_ used). `Date.now()` appears
only for timing/lease/expiry/skew — never as fabricated evidence.

---

## 7. Security Matrix (live + automated)

| Attack                                                                                | Expected            | Actual                          | Proof                                |
| ------------------------------------------------------------------------------------- | ------------------- | ------------------------------- | ------------------------------------ |
| Cross-workspace project id                                                            | 403                 | 403                             | api-server + E2E                     |
| Cross-workspace recommendation/outcomes/metrics/profile/signals/reasoning/calibration | 403                 | 403                             | 14-route sweep + E2E                 |
| Cross-workspace action id                                                             | 403 / 404           | 403 (foreign ws) / 404 (own ws) | **F2 test** + E2E                    |
| Cross-project telemetry (project owned by A, session B)                               | 403                 | 403                             | api-server ownership test            |
| Cross-project recommendation (same ws)                                                | 404 (no leak)       | 404                             | api-server ownership test            |
| Session substitution (no/expired token)                                               | 401                 | 401                             | AuthService.integration + api-server |
| Logout reuse                                                                          | 401                 | 401                             | api-server logout test               |
| Telemetry timestamp integrity (9 violation classes)                                   | 400, never repaired | 400                             | api-server timestamp test            |

No password/hash/token leakage: `ScryptPasswordHasher` (memory-hard, constant-
time compare, timing-oracle decoy on unknown user), `Logger` redacts
`password`/`token`/`secret`/etc., responses strip password hashes, `execSync`
clone errors are token-redacted before logging.

---

## 8. Database Integrity

`DurableFileDatabase`: atomic temp-file + `rename` commit, `fsync` best-effort,
transaction snapshot isolation (deep clone), in-process write mutex for the
defensive slow path, structural domain validation at the insert boundary,
`UNIQUE(workspace,idempotencyKey)`, `UNIQUE(workspace,action,sequence)`, FK
checks for executions/transitions. The single-process operating model and its
**non-guarantees** (no cross-process isolation, no row locks) are documented in
the class header and `docs/DATABASE.md`. Concurrent writes to **different
projects** cannot overwrite each other's state (F1 fix + the always-project-
scoped telemetry/signal/profile upserts). Covered by
`DurableFileDatabase.hardening.test.ts` (commit/rollback/uniqueness/mutex/
malformed file) and the new `CrossProjectCollision` tests.

---

## 9. E2E Evidence (real HTTP, this pass)

Dev server (`vite`, port 4173, Vite middleware → `handleApiRequest`) driven via
`curl`:

1. **signup** workspace A → token + `ws-e2e-a-*`
2. **login** → token
3. **connect repository** (apex monorepo) + **analysis** → `status: completed`
4. **recommendations** → 1 rec (`rec-add-ci-insight-ins-<ws>-<project>-no-ci`)
5. **decision-telemetry ACCEPT** → `pmd-…`, `originalH3Score 13.3`
6. **product-value** → acceptance `100 observed`, latency `120 observed`, bucket `awaiting_pm_telemetry` (N=1<5)
7. **cross-tenant**: workspace B reads A's recs/outcomes/product-value → **403 / 403 / 403**
8. **second project (proj-2) same workspace, same repo analyzed** → proj-core keeps its rec (1) and telemetry (1 observation); proj-2 has its own recs (1) — **no clobber**

**Durable DB inspection** (`/tmp/.../db.json`): `proj-core` coexists in **3**
workspaces (cross-workspace project-id coexistence); two `rec-add-ci-*`
recommendation rows coexist in `ws-e2e-a` with distinct project suffixes and
correct `projectId`; telemetry row correctly scoped `ws-e2e-a / proj-core`;
memberships correctly scoped. Persistence is exactly as the API presented it.

---

## 10. CI Status

**LOCAL CI-EQUIVALENT: PASS**

| Gate                             | Result                                          |
| -------------------------------- | ----------------------------------------------- |
| `pnpm install --frozen-lockfile` | OK (343 packages)                               |
| `pnpm type-check`                | **8/8 tasks, 0 errors**                         |
| `pnpm lint`                      | **8/8 tasks, 0 errors, 0 warnings**             |
| `pnpm test`                      | **4/4 tasks, 702 tests, 0 failures, 0 skipped** |
| `pnpm build`                     | **1/1 task** (web bundle 263.07 kB / gz 75.12)  |
| `pnpm audit --prod`              | **No known vulnerabilities found**              |

**GITHUB ACTIONS: BLOCKED — CI INFRASTRUCTURE/BILLING BLOCKER**

The latest `main` run (31361595848) failed in **2s** with the annotation:

> _"The job was not started because your account is locked due a billing issue."_

The job **never started** — no checkout, no install, no application step ran.
This is an external GitHub billing/runner limitation (account in Egypt, no
payment card available), **not an application or repository defect**. Per the
brief, billing is not being fixed, no payment method is added, and no security/
CI setting is weakened to make the GitHub UI green. The local gate above is the
authoritative reproduction.

---

## 11. Frozen Core

All seven files verified **byte-for-byte unchanged** (`git diff` on the seven
paths is empty). Single squashed commit in history, so a pre-H7 git baseline is
unavailable — the current HEAD SHA-256 below is the authoritative frozen value.

| File                                               | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `domain/entities/Action.ts`                        | `c8475b1386ff9fd04f984bd622f78d1e2254e72d4693ca30769c362a183cefba` |
| `domain/entities/Execution.ts`                     | `95ed686b2b15cdbe1ceef7fa9befb44164d365a25de4b477f62110114eb286f0` |
| `domain/entities/ActionTransition.ts`              | `304b44774d32b369adecbfee553224c4d4b307124778c494000aa4b97c9386a8` |
| `domain/repositories/ActionRepository.ts`          | `fe51a10cf397d89c2a7bafbb4761bc6c6bc74301c4bc3962df29089274fc951d` |
| `application/services/ActionApplicationService.ts` | `0187499b28b7abd7cc21e80305394e6676cd2a54217626dbf306cb8a067d41ea` |
| `application/services/ActionExecutor.ts`           | `f1f9a9c8fbf33bf47aa35353937d73a4b1e37cbf480612f1331d3baffe4365a2` |
| `application/services/ActionExecutionWorker.ts`    | `9520f703520bce3c7328d1b3cb6f0259429c4851228c1cbcd797028b4ab5c077` |

---

## 12. Tests

| Package          | Files  | Tests   | Failures | Skipped |
| ---------------- | ------ | ------- | -------- | ------- |
| `@apex/ai-core`  | 51     | 624     | 0        | 0       |
| `@apex/analysis` | 3      | 36      | 0        | 0       |
| `@apex/prompts`  | 2      | 23      | 0        | 0       |
| `@apex/web`      | 3      | 19      | 0        | 0       |
| **Total**        | **59** | **702** | **0**    | **0**   |

New regression tests added this pass (each proves a real invariant, not an
implementation detail):

- `CrossProjectCollision.test.ts` — 5 repository-level coexistence invariants (recommendations, findings, telemetry, outcomes, signals/profiles) across two projects in one workspace.
- `CrossProjectServiceIsolation.test.ts` — 1 end-to-end invariant: two projects analyzing the same repo keep independent findings/recommendations; re-analysis of one does not corrupt the other.
- `api-server.test.ts` (+1) — cross-workspace action-endpoint isolation (403/404/200).

type-check **PASS** · lint **PASS** · build **PASS** · audit **clean**.

---

## 13. Remaining Issues

Nothing hidden. All are non-blocking; none require H8.

| Issue                                                                                     | Severity | Why it remains                                              | Frozen? | Mitigation                                                                       | Future fix                                                                  |
| ----------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ActionExecutor` retry spans two persistence calls (non-atomic)                           | LOW      | Frozen core (`ActionExecutor.ts`)                           | Yes     | Boundary tests cover retry semantics; DB transaction is the documented fix point | Repository-level atomic retry when frozen core is unfrozen                  |
| `console.log`/`console.warn` in `ActionExecutor`/`ActionExecutionWorker` (`[EVENT]` logs) | LOW      | Frozen core                                                 | Yes     | `idempotencyKey` already redacted in the sanitized event payload                 | Structured `Logger` when core unfrozen                                      |
| H3 priority score unbounded (>10 possible, e.g. 13.3)                                     | INFO     | H3 scoring formula is a product contract                    | No      | UI renders the exact number; calibrator clamps the _calibrated_ score to [0,10]  | Contract decision; document if the 0–10 scale is tightened                  |
| `getActivityLog` per-action N+1 reads                                                     | LOW      | `ActionRepository` (frozen) exposes only per-action queries | Yes     | Bounded by typical action counts                                                 | Batch query when interface unfrozen                                         |
| Single-process rate limiter & DB                                                          | INFO     | Documented architecture limit (`DATABASE.md`)               | No      | Explicit non-guarantees documented                                               | Swap `DurableFileDatabase` for PostgreSQL via the same repository contracts |
| GitHub Actions blocked                                                                    | INFO     | External billing lock; no payment card (Egypt)              | No      | Local CI-equivalent gate is authoritative and green                              | Resolve GitHub billing externally; **not** an app defect                    |
| Stale residual lines in prior audit docs                                                  | INFO     | Historical documents (Phase 13) left intact                 | No      | This document records them resolved                                              | —                                                                           |

**Two prior "residual" notes now RESOLVED in code** (re-verified independently
this pass): (a) UI records all four decision kinds — not ACCEPT-only;
(b) confidence bucket uses PM-decision `decisionCount` only — not a mixed
population.

---

## 14. Git State

- **HEAD (this branch):** the new commit created at the end of this pass (see `git log`).
- **Branch:** `arena/019fea5a-apex-ai-product-manager`
- **Working tree after commit:** clean (no stray DB files — `database-*/` and `dev-database/` are gitignored; verified).
- **Diff vs `main`:** only the three intentional non-frozen source/test changes + this document. Frozen core diff is empty.

Changed (non-frozen) source:

- `packages/ai-core/src/infrastructure/repositories/SqlProductRepository.ts` (F1)
- `packages/ai-core/src/infrastructure/repositories/SqlRecommendationOutcomeRepository.ts` (F1)
- `apps/web/src/api-server.test.ts` (F2)
- new `packages/ai-core/src/infrastructure/repositories/__tests__/CrossProjectCollision.test.ts` (F1)
- new `packages/ai-core/src/application/services/__tests__/CrossProjectServiceIsolation.test.ts` (F1)
- new `docs/FINAL_PRE_H8_AUDIT_PASS2.md` (this report)

---

## 15. Final Gate

```
H7 ENGINEERING: COMPLETE
H7 OBSERVATION: READY
H8: BLOCKED
```

All H1–H7 engineering contracts independently re-verified from source, tests,
build, and a live end-to-end runtime. One MEDIUM isolation-contract defect
(F1) found, proven, fixed, and regression-tested. One LOW test gap (F2) closed.
Two stale residual claims (F3) corrected. Frozen core untouched. Local CI-
equivalent PASS; GitHub Actions blocked by external billing only. **H8 is not
started.**
