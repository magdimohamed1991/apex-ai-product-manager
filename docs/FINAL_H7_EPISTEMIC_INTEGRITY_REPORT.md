# APEX — Final H7 Epistemic Integrity & Tenancy Remediation Report

> **Date:** 2026-08-10
> **Branch:** `arena/019fea0a-apex-ai-product-manager`
> **Base:** `670b7d4d356e6533dc0d5f5e0e1b936c1d587177` (merged H7 remediation, PR #5)
> **Final commit:** `20d799bd7447085d931e3dc9c20bdc0efb582085`
> **Scope:** One final skeptical, evidence-first pass on the remaining H7
> measurement-integrity issues. **No H8 work was started.**

---

## 1. Findings

Every finding below was verified from the actual source, tests, and a live
runtime run — not from prior reports.

**Finding 1 — No evidence was becoming negative evidence (REAL BUG, FIXED).**
`H6PrioritizationCalibrator` applied `outcomeReliabilityMultiplier = 0.9` whenever
`outcomeVerifiedRate = 0`, even with zero outcome observations. A
`verifiedCount / outcomeCount` that evaluated to 0 _because there was no
denominator_ was read as genuine negative evidence. The adoption dimension had
the same class of defect (an `adoptionRate` of 0 from no observations could drag
the weight below neutral).

**Finding 2 — Telemetry ids were not project-scoped (REAL BUG, FIXED).**
`PMDecisionTelemetryService.computeId` hashed only
`(workspaceId | recommendationId | decisionStartedAt)`. Two projects in the same
workspace with the same recommendation id and timestamp produced the SAME
telemetry id, so the `(id, workspaceId)`-scoped repository upsert could overwrite
one project's row with another's.

**Finding 3 — No explicit telemetry ownership check at the boundary (REAL GAP, FIXED).**
The service relied on a project-scoped recommendation lookup (which already
rejected cross-project recommendations) but did not explicitly verify that the
claimed **project** belongs to the authenticated workspace. A cross-workspace
project submission fell through to a `404` rather than a clear `403`.

**Finding 4 — Telemetry provenance was numerator-only (REAL GAP, FIXED).**
Rate signals (ACCEPTANCE / REJECTION / DEFER / OVERRIDE) stored only the numerator
records in `sourceTelemetryIds` (e.g. only the ACCEPT records for ACCEPTANCE).
An auditor could not reconstruct `value = ACCEPT / ALL_DECISIONS` because the
denominator population was absent. `DECISION_LATENCY` and
`PRIORITY_OVERRIDE_DELTA` also lacked full population provenance.

**Finding 5 — Signal identity ignored the observation population (REAL BUG, FIXED).**
Signal source hashes for rate signals were computed over the numerator only.
Adding 10 REJECTs to 10 ACCEPTs changed the value (100% → 50%) but the signal's
deterministic identity (derived from the numerator hash) could fail to change,
breaking the "no stale signal survives" invariant in the presence of a changing
population.

**Finding 6 — `0` was used ambiguously (REAL CONCERN, ADDRESSED).**
`0` could mean "zero observations" (no evidence → must be neutral) or "observed
zero rate" (e.g. 20 decisions, 0 ACCEPTs → genuine negative evidence). The two are
semantically different and were not always distinguished. Now explicitly
distinguished and regression-tested across every calibration dimension.

**Finding 7 — Decision confidence could depend on the largest signal (REAL CONCERN, FIXED).**
`decisionObservationCount` used `Math.max(...decisionSignals.observationCount)`.
For the decision mixes required by the contract this coincidentally equaled N,
but the derivation was fragile. Now the confidence is taken from the
authoritative full-population carrier, guaranteeing `N/(N+10)` for every mix.

**Findings 8–10 — Boundedness/determinism, safety floors, and tenancy (already sound).**
Re-verified and expanded with new regression tests. The calibration bounds
`[0.85, 1.15]`, the safety floors (`critical ≥ 8.5`, `high ≥ 7.0`), and
multi-tenant/multi-project isolation were already correct; new tests make the
epistemic guarantees explicit.

**Finding 11 — Live E2E (verified this pass).** The full flow was run against the
real dev server and the durable DB was inspected directly (details in §9).

**Finding 12 — Docs stale (FIXED).** `PRE_H8_H7_MEASUREMENT_AUDIT.md` and
`FINAL_PRE_H8_AUDIT.md` still cited old test counts (56 files / 666 tests) and the
`h6-v1` calibration version. Corrected and extended with the epistemic contract.

---

## 2. Fixes

Exact files and architectural changes (none in the frozen core):

| File                                                                | Change                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain/entities/ProductAdaptive.ts`                                | Added `numeratorTelemetryIds` to `LearningSignal`; added `outcomeObservationCount` to `CategoryCoefficient`; documented the denominator/numerator provenance contract.                                                                                                                                                                     |
| `application/services/AdaptiveProfileCompiler.ts`                   | Adoption weight gated: `< MIN_OBSERVATIONS_FOR_FAVORED` adoption observations → exactly `1.0`. Rate signals now carry the complete denominator population in `sourceTelemetryIds`, the numerator in `numeratorTelemetryIds`, and their source hash (signal identity) is over the complete population. `outcomeObservationCount` populated. |
| `application/services/H6PrioritizationCalibrator.ts`                | Outcome multiplier gated on `outcomeObservationCount` (zero/insufficient → `1.0`; observed zero rate → genuine `0.9`). Decision confidence derived from the full-population carrier (`N/(N+10)`), not the largest signal. Added `MIN_OBSERVATIONS_FOR_OUTCOME` and an explicit "outcome evidence neutral" trace in the explanation.        |
| `application/services/PMDecisionTelemetryService.ts`                | Deterministic telemetry id now includes `projectId`.                                                                                                                                                                                                                                                                                       |
| `infrastructure/repositories/SqlProductRepository.ts`               | Telemetry upsert scoped by `(id, workspaceId, projectId)`.                                                                                                                                                                                                                                                                                 |
| `application/services/APEXProductService.ts`                        | Added project-ownership verification in `recordPMDecision`: cross-workspace/nonexistent project → `403 AuthorizationError`; recommendation must belong to the claimed project → `404 NotFoundError`.                                                                                                                                       |
| `application/services/__tests__/H7EpistemicIntegrity.test.ts`       | **NEW** — 28 regression tests (see §7).                                                                                                                                                                                                                                                                                                    |
| `application/services/__tests__/H7LearningEffect.test.ts`           | Updated provenance/multi-tenant tests to the denominator+numerator semantics.                                                                                                                                                                                                                                                              |
| `application/services/__tests__/AdaptiveIntelligence.test.ts`       | Corrected one assertion to the new adoption-neutrality contract (single observation is insufficient → neutral `1.0`).                                                                                                                                                                                                                      |
| `apps/web/src/api-server.test.ts`                                   | Added an HTTP-boundary telemetry-ownership test (403 cross-workspace project, 404 cross-project/nonexistent recommendation, 200 valid).                                                                                                                                                                                                    |
| `docs/PRE_H8_H7_MEASUREMENT_AUDIT.md`, `docs/FINAL_PRE_H8_AUDIT.md` | Corrected counts/version; added the epistemic-integrity contract (§23) and final-pass evidence.                                                                                                                                                                                                                                            |

---

## 3. Epistemic Integrity

**Proven: `no evidence != negative evidence`.**

- **Zero observations → neutral.** A dimension with zero/insufficient
  observations contributes exactly `1.0` (no influence) in every dimension:
  - Adoption: `< MIN_OBSERVATIONS_FOR_FAVORED` observations → weight `1.0`.
  - Outcome: `< MIN_OBSERVATIONS_FOR_OUTCOME` outcome observations →
    `outcomeReliabilityMultiplier = 1.0` (never `0.9`).
  - Decision: zero decisions → no rate signal at all (no influence).
- **Observed zero rate → real negative evidence.** A measured `0/N` rate over a
  sufficient population is genuine:
  - 20 outcomes, 0 verified → `outcomeReliabilityMultiplier = 0.9`.
  - 20 decisions, 0 ACCEPTs → `ACCEPTANCE` signal `value = 0`, evidence state
    `observed`, numerator empty, denominator `20`.
- **Independent dimensions.** Adoption, execution, outcome, and PM-decision
  telemetry are calibrated separately. H7 telemetry is valid with or without
  unrelated action/outcome evidence (regression-tested: 20 ACCEPT + 0 outcomes +
  0 adoption still lets the decision component move H6).
- **Confidence is a bounded operational heuristic, not statistical
  significance.** `decisionConfidence = N/(N+10)` over the complete PM decision
  population — never a claim of statistical significance.

The durable E2E run demonstrates the neutral vs. negative distinction in practice
(§9): scenario A (20 ACCEPT) → `preferenceMultiplier = 1.15`,
`outcomeReliabilityMultiplier = 1.0` (no outcomes → neutral), while scenario B
(20 REJECT) → `preferenceMultiplier = 0.85` (observed 100% rejection → negative).

---

## 4. H7 → H6 Causal Chain

```
PM decision (ACCEPT/REJECT/DEFER/OVERRIDE + window + optional priority)
   │  recordDecision → PMDecisionTelemetryService (project-scoped id,
   │  strict window/schema validation) → durable store
   ▼
persisted H7 telemetry (workspaceId | projectId | recommendationId | …)
   │
   ▼
AdaptiveProfileCompiler.compileProfile
   │  rate signals built over the COMPLETE population:
   │  sourceTelemetryIds (denominator) + numeratorTelemetryIds (numerator);
   │  signal identity = sha256(workspace|project|category|type|full-population)
   ▼
H7 learning signals (ACCEPTANCE/REJECTION/DEFER/OVERRIDE/
                     PRIORITY_OVERRIDE_DELTA/DECISION_LATENCY) + profile
   │
   ▼
H6PrioritizationCalibrator.calibrate
   │  preferenceMultiplier = clamp(adoption weight + decisionAdjustment +
   │  overrideDeltaAdjustment, 0.85, 1.15)  (decisionConfidence = N/(N+10))
   │  outcomeReliabilityMultiplier gated on outcomeObservationCount
   │  safety floors applied after calibration, before presentation
   ▼
recalculated prioritization (calibratedScore)
```

Verified live: decision → telemetry → metrics → signals → profile → calibration →
changed score, with all artifacts persisted to the durable DB.

---

## 5. Multi-Tenant Isolation

Regression matrix (all passed):

| Scope                   | Telemetry | Signals  | Profile  | Calibration | Same-ID behavior                             |
| ----------------------- | --------- | -------- | -------- | ----------- | -------------------------------------------- |
| Workspace A / Project A | isolated  | isolated | isolated | isolated    | own rows                                     |
| Workspace A / Project B | isolated  | isolated | isolated | isolated    | distinct telemetry id for same rec+timestamp |
| Workspace B / Project A | isolated  | isolated | isolated | isolated    | cross-workspace POST → **403**; distinct id  |

Explicitly tested "same IDs across tenants/projects": the same recommendation id,
same telemetry timestamp, and same decision recorded in `WS-A/proj-A`,
`WS-A/proj-B`, and `WS-B/proj-A` produce **three distinct telemetry rows and three
distinct ids** (no collision, no overwrite). Learning signals, profiles, and
calibration are independently computed per `(workspace, project)` and never leak
between scopes.

---

## 6. Frozen Core

The seven frozen files are **byte-identical** to the pre-pass baseline
(SHA-256 verified on both the working tree and the committed tree):

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `Action.ts`                   | `c8475b1386ff9fd04f984bd622f78d1e2254e72d4693ca30769c362a183cefba` |
| `Execution.ts`                | `95ed686b2b15cdbe1ceef7fa9befb44164d365a25de4b477f62110114eb286f0` |
| `ActionTransition.ts`         | `304b44774d32b369adecbfee553224c4d4b307124778c494000aa4b97c9386a8` |
| `ActionRepository.ts`         | `fe51a10cf397d89c2a7bafbb4761bc6c6bc74301c4bc3962df29089274fc951d` |
| `ActionApplicationService.ts` | `0187499b28b7abd7cc21e80305394e6676cd2a54217626dbf306cb8a067d41ea` |
| `ActionExecutor.ts`           | `f1f9a9c8fbf33bf47aa35353937d73a4b1e37cbf480612f1331d3baffe4365a2` |
| `ActionExecutionWorker.ts`    | `9520f703520bce3c7328d1b3cb6f0259429c4851228c1cbcd797028b4ab5c077` |

`git status` confirms **no frozen core file was modified** (not in the change set).

---

## 7. Tests

**Exact final test count, derived from the actual test runner (`pnpm test`):**

| Package          | Files  | Tests   |
| ---------------- | ------ | ------- |
| `@apex/ai-core`  | 49     | 618     |
| `@apex/analysis` | 3      | 36      |
| `@apex/prompts`  | 2      | 23      |
| `@apex/web`      | 3      | 18      |
| **Total**        | **57** | **695** |

`695 tests, 0 failed, 0 skipped` — up from 666 (this pass added 28
`H7EpistemicIntegrity` tests and 1 web HTTP-ownership test; two existing suites
were updated to the corrected semantics). Every modification has regression
coverage.

---

## 8. Build / Type-check / Lint / Audit

| Gate              | Result                                           |
| ----------------- | ------------------------------------------------ |
| `pnpm type-check` | **8/8 tasks successful, 0 errors**               |
| `pnpm lint`       | **8/8 tasks successful, 0 errors, 0 warnings**   |
| `pnpm test`       | **4/4 tasks successful — 695 tests, 0 failures** |
| `pnpm build`      | **1/1 tasks successful**                         |
| `pnpm audit`      | **No known vulnerabilities found**               |

---

## 9. Live E2E (real app, durable DB)

A real Vite dev server was started and the full flow driven over HTTP:
signup → workspace → project → repository → analysis → recommendation → PM
decision → persisted H7 telemetry → H7 metrics → adaptive profile compilation →
H7 signals → H6 calibration → recalculated prioritization → outcome → H5
verification → updated metrics. The durable DB (`db.json`) was inspected directly.

Happy path: telemetry `pmd-8baff6d6…` (ACCEPT, `originalH3Score 13.3`), H7 metrics
acceptance `100` / `observed`, profile `totalDecisionsObserved: 1`, outcome
`VERIFIED_SUCCESS`, idempotent re-record returns the identical id.

Decision scenarios (each over a fresh workspace, 20 decisions):

| Scenario                     | Signals (type, value, obs, src, num)                                                               | Calibration                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| A — 20 ACCEPT                | ACCEPTANCE `1.0, obs 20, src 20, num 20`                                                           | pref `1.15`, out `1.0` (no outcome → neutral), deterministic |
| B — 20 REJECT                | REJECTION `1.0, obs 20, src 20, num 20`; ACCEPTANCE `0` observed (`num 0, src 20`)                 | pref `0.85` (floor), out `1.0`                               |
| C — 20 OVERRIDE (Δ negative) | OVERRIDE `1.0`; PRIORITY_OVERRIDE_DELTA `11.3, obs 20, src 20, num 20`                             | pref `≈0.933`, out `1.0`                                     |
| D — 20 mixed (5/5/5/5)       | ACCEPTANCE/REJECTION/DEFER/OVERRIDE each `0.25, obs 20, src 20, num 5`; DELTA over the 5 overrides | pref `≈0.933`, deterministic                                 |

For every scenario: telemetry persisted, signal persisted, full denominator +
numerator provenance persisted, profile persisted, calibration deterministic, score
changed only for legitimate evidence, and **no unrelated evidence dimension created
an influence** (outcome stayed neutral with zero outcomes; adoption stayed neutral
with insufficient adoption).

Durable DB inspection: **81 telemetry records** (26 ACCEPT, 25 REJECT, 25 OVERRIDE,
5 DEFER), **15 learning signals** (all with `sourceTelemetryIds` = full population
and `numeratorTelemetryIds`), **7 compiled profiles** (`calibrationVersion: h6-v2`),
**3 outcomes** all `VERIFIED_SUCCESS`.

---

## 10. Remaining Issues

Honest assessment — what remains and why it cannot be safely fixed here:

1. **Telemetry confidence is a heuristic, not a statistical guarantee.** `N/(N+10)`
   is a deterministic dampener chosen by the engineering contract. It is correct
   as an operational safeguard but is not a calibrated statistical posterior.
   This is intentional and documented; changing it would be an H7 contract change,
   not an integrity bug.
2. **Live E2E used the development mock LLM / non-production mode.** The E2E proves
   the measurement pipeline end-to-end but did not exercise a real `OPENAI_API_KEY`
   reasoning path (H4). That path is separately covered by the H4 unit/API tests
   and the production-guard tests; no reasoning path change was part of this pass.
3. **`outcomeReliabilityMultiplier` bounds are symmetric constants (0.9–1.1).**
   The 0.2 slope is a documented engineering choice, not an empirically derived
   coefficient. Same class as #1 — a contract constant, not an integrity defect.
4. **`ActionExecutor`/worker frozen-core residuals** (retry non-atomicity,
   `console.log` logging) are documented frozen items from the prior audit and were
   explicitly out of scope (frozen files, non-negotiable rule #1).
5. **H8 remains blocked.** These fixes harden the measurement loop; they do not
   accumulate the real PM interaction data H8 requires.

None of these are correctness/security/tenancy/epistemic regressions; each is an
intentional, documented contract or a frozen-scope residual.

---

## 11. Final Decision

All of the following pass:

- ✅ Every executable gate (`type-check`, `lint`, `test`, `build`, `audit`)
- ✅ 695 tests / 57 files, 0 failures
- ✅ Frozen core byte-identical (SHA-256 verified, working tree + committed tree)
- ✅ Working tree clean; exact final commit `20d799bd7447085d931e3dc9c20bdc0efb582085`
- ✅ Live E2E on the real server with durable-DB verification (happy path + 4 scenarios)
- ✅ Epistemic integrity proven: no evidence is neutral, observed zero rate is
  negative, telemetry provenance is complete, telemetry ids are project-scoped,
  cross-project relationships rejected, confidence is a bounded heuristic
- ✅ Multi-tenant / multi-project isolation matrix green

**`H7 ENGINEERING + MEASUREMENT LOOP: FROZEN`**

**`H7 OBSERVATION: READY`**

**`H8: BLOCKED`** — H8 remains blocked because genuine H7 empirical evidence must
first accumulate from real PM interactions; this integrity pass did not (and must
not) substitute test coverage for that observation phase.
