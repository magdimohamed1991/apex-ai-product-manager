# PRE-H8 H7 Measurement Integrity & Remediation Audit

**Date:** 2026-08-09 (final evidence-first remediation pass)
**Branch:** `arena/019fe817-apex-ai-product-manager`
**Base:** `88d6c0217d7aac3b3eb7f7819739b0b03d077a46` (prior H7 remediation commit)

---

## 1. Executive Summary

This audit performs an exhaustive, evidence-first verification and remediation pass focused on H7 measurement integrity and the H6 ↔ H7 learning loop — the final pass before H8. Every claim below was verified from the actual source, tests, and live runtime behavior (a real dev server + durable on-disk database), not from prior reports.

**Findings closed in this final pass:**

1. **CRITICAL — H6 did not actually consume H7 signal VALUES.** The prior pass made the compiler _generate_ REJECTION/DEFER/OVERRIDE/DECISION_LATENCY/PRIORITY_OVERRIDE_DELTA signals, but `H6PrioritizationCalibrator` still derived the effective calibration only from `pmCalibrationWeight` (adoption) + `outcomeVerifiedRate`, using the H7 signals purely as evidence gates. **Fixed:** the calibrator (contract `h6-v2`) now computes a deterministic, bounded adjustment from the real telemetry rates — `valence = acceptRate − rejectRate`, ambiguity dampening from override rate/delta, and a direction-aware signed override-delta correction — all clamped to [0.85, 1.15]. New `ACCEPTANCE` signal added so ACCEPT rate comes from the telemetry population (never action status).
2. **HIGH — acceptance-rate population was wrong.** `ProductValidationService.decisionAcceptanceRate` and `RecommendationOutcomeService.getDecisionQualityMetrics` used approved-actions/recommendations. **Fixed:** `decisionAcceptanceRate = ACCEPT telemetry / total decision telemetry` with `observationCount = decisionCount`. Added `decisionRejectionRate`, `decisionDeferRate`, `decisionOverrideRate`, `meanPriorityOverrideDelta` as PM Decision Metrics. Execution/Outcome metrics kept in separate populations.
3. **HIGH — UI recorded only ACCEPT.** **Fixed:** the Recommendation Center now exposes Accept, Accept & Execute, Reject, Defer, and Override (with a controlled numeric priority input). The client sends only `decision`, `pmSelectedPriority` (OVERRIDE), and the real window timestamps + ids — never H3/H6 scores.
4. **MEDIUM — timestamp integrity gaps.** **Fixed:** strict ISO-8601 parsing at the HTTP boundary (non-ISO formats rejected), `recommendationPresentedAt <= decisionStartedAt <= decisionCompletedAt` enforced at BOTH the API boundary and the domain validator, and the clock-skew policy now validates all three client timestamps consistently (5-minute future tolerance) plus the 24-hour duration cap. Invalid telemetry is rejected, never repaired.
5. **MEDIUM — signal provenance.** `LearningSignal` now carries typed `sourceTelemetryIds` (exact persisted telemetry record ids) and `meanSignedOverrideDelta` for every telemetry-derived signal: LearningSignal → exact telemetry observations → exact PM decisions → exact recommendation → project → workspace.
6. **LOW — the earlier audit could not claim the UI supported all four decisions.** It now does (see #3); the doc's stale "not implemented" rows are removed.

**Epistemic safeguards preserved:** N < 5 → low/insufficient evidence; 5 ≤ N < 20 → early convergence; N ≥ 20 → "high within the APEX operational measurement framework" — NEVER "statistically significant", "scientifically proven", or "validated universally". DECISION_LATENCY is observational-only evidence (no "faster = better" quality score); it is persisted and auditable but never modifies calibration.

**Final Gate Status (verified this pass):**

- `pnpm type-check` — PASS (8/8 tasks)
- `pnpm lint` — PASS (8/8 tasks)
- `pnpm test` — PASS (56 files, 666 tests; 0 failed, 0 skipped)
- `pnpm build` — PASS (1/1 tasks)
- `pnpm audit` — PASS ("No known vulnerabilities found")
- Frozen core — byte-identical (SHA-256 verified, see §3)
- Live E2E walking skeleton — PASS (real HTTP server, durable on-disk persistence, full decision loop; see §20)

---

## 2. Repository State

- **Monorepo:** pnpm workspaces with Turborepo
- **Packages:** `@apex/ai-core`, `@apex/analysis`, `@apex/contracts`, `@apex/prompts`, `@apex/shared`, `@apex/ui`, `@apex/config`, `@apex/design-tokens`, `@apex/web`
- **Runtime:** Node.js 22+, TypeScript 6.x, Vitest 4.x
- **Architecture:** Single-process durable file database, domain-driven design

---

## 3. Frozen-Core Verification

All 7 frozen core files are **byte-identical** to the pre-audit state:

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `Action.ts`                   | `c8475b1386ff9fd04f984bd622f78d1e2254e72d4693ca30769c362a183cefba` |
| `Execution.ts`                | `95ed686b2b15cdbe1ceef7fa9befb44164d365a25de4b477f62110114eb286f0` |
| `ActionTransition.ts`         | `304b44774d32b369adecbfee553224c4d4b307124778c494000aa4b97c9386a8` |
| `ActionRepository.ts`         | `fe51a10cf397d89c2a7bafbb4761bc6c6bc74301c4bc3962df29089274fc951d` |
| `ActionApplicationService.ts` | `0187499b28b7abd7cc21e80305394e6676cd2a54217626dbf306cb8a067d41ea` |
| `ActionExecutor.ts`           | `f1f9a9c8fbf33bf47aa35353937d73a4b1e37cbf480612f1331d3baffe4365a2` |
| `ActionExecutionWorker.ts`    | `9520f703520bce3c7328d1b3cb6f0259429c4851228c1cbcd797028b4ab5c077` |

**No frozen core files were modified.**

---

## 4. H1 Audit

**Status:** PASS

H1 ingestion (repository discovery, static analysis, evidence collection) operates correctly. The pipeline discovers repository structure, applies deterministic rules (NoCI, NoDocker, NoTests, NoTypeScript, MonorepoDetected), and produces findings with evidence provenance.

- Rules are deterministic (same evidence → same findings)
- Evidence IDs reference actual scan results
- No hidden randomness in the analysis pipeline

---

## 5. H2 Audit

**Status:** PASS

H2 PM workflow (recommendation generation, proposed actions, action promotion) operates correctly. Recommendations carry typed `category` metadata for H6 learning.

- Recommendations are project-scoped through `StoredRecommendation.projectId`
- Proposed actions are linked to their parent recommendation
- Approval flow uses the domain state machine (`transitionAction`)

---

## 6. H3 Audit

**Status:** PASS (with documented limitations)

H3 prioritization is deterministic:

- Same evidence → same score
- No mutation of canonical H3 history
- No hidden randomness
- No H6 modification of canonical H3 history
- Score provenance is inspectable via `originalH3Score` field in telemetry

**Documented heuristic limitation:** H3 uses category/rule-based heuristics with fixed weights. These weights are NOT empirically proven — they are engineering estimates. H7 exists to observe whether these weights produce good PM outcomes.

---

## 7. H4 Audit

**Status:** PASS (with documented epistemic limitations)

H4 reasoning (LLM-based product reasoning) operates correctly with these safeguards:

- Schema validation ensures output conforms to expected structure
- Grounding validator checks for keyword overlap with repository evidence
- `Historical learning signals are observations about prior behavior, not facts about the current repository` — this instruction is preserved in the reasoning prompt
- Reasoning is unavailable (typed `unavailable` record) when H3 decoration is missing

**Documented epistemic limitation:** Keyword overlap alone is NOT equivalent to evidence provenance. The grounding mechanism can accept claims that contain a matching keyword while making unsupported assertions. This is an intentional limitation documented for future H7 observation.

---

## 8. H5 Audit

**Status:** PASS

H5 outcome verification:

- `recommendation → decision → execution → verification → outcome` chain is correctly linked by `workspaceId`, `projectId`, `recommendationId`
- `NOT_VERIFIABLE` is never represented as success
- Project-scoping invariant enforced: recommendation must belong to the claimed project
- Verification strategies are registry-based (open extension point)

---

## 9. H6 Audit

**Status:** PASS (after remediation)

H6 adaptive intelligence:

- `AdaptiveProfileCompiler` generates deterministic learning signals (incl. telemetry-derived ACCEPTANCE/REJECTION/DEFER/OVERRIDE/DECISION_LATENCY/PRIORITY_OVERRIDE_DELTA with `sourceTelemetryIds`)
- `H6PrioritizationCalibrator` (contract `h6-v2`) consumes the H7 signal VALUES: telemetry valence (accept − reject), ambiguity dampening for override evidence, and a direction-aware signed override-delta correction; deterministic and bounded
- Critical safety floor (≥ 8.5) and high safety floor (≥ 7.0) cannot be violated (verified under 100% rejection/defer/override, extreme delta, zero/failed outcomes, mixed signals)
- Multiplier bounded to [0.85, 1.15]
- `insufficient_evidence` signals are excluded from the formula and flagged in the explanation; categories with no observed signal are dampened to zero influence
- DECISION_LATENCY is observational-only: auditable, never score-modifying

---

## 10. H7 Audit

**Status:** PASS (after remediation)

H7 measurement:

- PM decision telemetry records real decision windows (real timestamps from the client clock; skew-free latency)
- All 4 decision types (ACCEPT/REJECT/DEFER/OVERRIDE) accepted through the API and the UI
- Timestamps validated at the DOMAIN and HTTP boundaries: strict ISO-8601 only, window ordering `presentedAt <= startedAt <= completedAt`, 5-minute future-skew limit applied to ALL three timestamps, 24-hour max duration — violations rejected with 400, never repaired
- Deterministic record ID (sha256 of workspace+recommendation+decisionStartedAt) ensures idempotency
- Client timestamps labeled as `client-observed telemetry`
- Confidence classification uses `decisionCount` ONLY
- PM Decision Metrics: Acceptance / Rejection / Defer / Override / Decision Latency / Priority Override Delta — all derived from the telemetry population only

---

## 11. H6 ↔ H7 Learning Loop (CRITICAL FIX)

### Before (BROKEN):

The `AdaptiveProfileCompiler` did NOT consume `PMDecisionTelemetry`. It only observed:

- `ADOPTION` signals (from action approvals)
- `EXECUTION_SUCCESS` signals (from action completions)
- `OUTCOME_SUCCESS` signals (from outcome verifications)

REJECT, DEFER, and OVERRIDE decisions were invisible to H6.

### After (FIXED):

The `AdaptiveProfileCompiler` now fetches `PMDecisionTelemetry` via `productRepository.getPMDecisionTelemetryByProject()` and generates:

| Signal Type               | Description                                     | Threshold        | Telemetry provenance                 |
| ------------------------- | ----------------------------------------------- | ---------------- | ------------------------------------ |
| `ADOPTION`                | Recommendation approval rate (action-based)     | ≥ 3 observations | — (action population)                |
| `EXECUTION_SUCCESS`       | Action completion rate                          | ≥ 3 terminal     | — (action population)                |
| `OUTCOME_SUCCESS`         | Verified success rate                           | ≥ 3 outcomes     | — (outcome population)               |
| `ACCEPTANCE`              | **NEW** — ACCEPT telemetry / decision telemetry | ≥ 3 decisions    | `sourceTelemetryIds` (ACCEPT rows)   |
| `REJECTION`               | PM explicitly rejected                          | ≥ 3 rejections   | `sourceTelemetryIds` (REJECT rows)   |
| `DEFER`                   | PM deferred decision                            | ≥ 3 deferrals    | `sourceTelemetryIds` (DEFER rows)    |
| `OVERRIDE`                | PM overrode APEX priority                       | ≥ 3 overrides    | `sourceTelemetryIds` (OVERRIDE rows) |
| `DECISION_LATENCY`        | Average decision window (observational only)    | ≥ 3 decisions    | `sourceTelemetryIds` (all rows)      |
| `PRIORITY_OVERRIDE_DELTA` | Mean \|H6 − PM\| + signed mean                  | ≥ 3 overrides    | `sourceTelemetryIds` (delta rows)    |

Every signal contains full provenance:

- `workspaceId`, `projectId`, `category`
- `sourceRecommendationIds` (the actual observations)
- `sourceTelemetryIds` (**NEW** — the exact persisted `PMDecisionTelemetry.id` records that produced the signal; no opaque signal can influence H6)
- `meanSignedOverrideDelta` (**NEW** — signed mean of `pmSelectedPriority − calibratedH6Score`, so H6 can distinguish small consistent corrections from large systematic corrections _with direction_)
- `calibrationVersion` (reproducibility — `h6-v2` for this contract)
- `evidenceState` (observed/estimated/insufficient_evidence)

### Calibration now consumes the H7 signal VALUES (h6-v2 contract):

Previously the calibrator used H7 signals only as evidence gates (`insufficient_evidence` → dampen) while the actual multiplier came from adoption + outcome rates. **This was insufficient.** The h6-v2 contract is:

1. `valence = clamp(acceptRate − rejectRate, −1, 1)` — ACCEPT/REJECT/DEFER rates come ONLY from the PMDecisionTelemetry population (never action status).
2. `ambiguity = clamp(0.5·overrideRate + 0.5·clamp((meanAbsDelta − 1)/4), 0, 1)` — a high override rate and/or large deltas mean the PM disagrees with APEX's absolute priority scale; acceptance can no longer be read as pure preference (contradictory-signal protection).
3. `decisionAdjustment = valence · 0.3 · confidence · (1 − ambiguity)`, with `confidence = n/(n+10)` — the documented bounded dampener, never a statistical significance claim.
4. `overrideDeltaAdjustment = clamp(meanSignedDelta/5, −1, 1) · 0.1 · confidence` — direction-aware; a 1-point correction moves at most ±0.013, a ≥5-point systematic push at most ±0.067 (both at n=20).
5. `preferenceMultiplier = clamp(pmCalibrationWeight + decisionAdjustment + overrideDeltaAdjustment, 0.85, 1.15)`.
6. `DECISION_LATENCY` is observational-only: persisted, included in `appliedSignals`, described in the explanation — never used to modify scores (the calibration contract defines no "faster = better" interpretation).
7. Epistemic gate: a signal with `insufficient_evidence` is excluded from the formula and flagged in the explanation — it does not veto other observed evidence (so a 20-decision telemetry population calibrates even when one kind's count is below its own threshold), and when NO signal is observed the category is dampened to zero influence (legacy guarantee preserved).

### Confidence Classification (FIXED):

`ProductValidationService` now uses `decisionCount` (from PM decision telemetry) for the H7 confidence bucket, NOT the combined `recommendations + outcomes + actions` count.

| N          | Bucket                       |
| ---------- | ---------------------------- |
| N < 5      | `awaiting_pm_telemetry`      |
| 5 ≤ N < 20 | `early_convergence`          |
| N ≥ 20     | `high_within_apex_framework` |

The N ≥ 20 state is explicitly scoped to the internal APEX operational measurement framework — NOT called "statistically significant."

---

## 12. Multi-Tenant Security

**Status:** PASS

Exhaustive ID-substitution audit:

- All project-scoped endpoints require workspace membership via `authenticateAndAuthorize`
- Cross-workspace access returns 403 (not 404, preventing information leaks)
- Workspace IDs generated server-side (not client-supplied)
- Project IDs generated server-side
- All DB upserts scoped by `(id, workspaceId)` — never clobbers another tenant's row
- PM decision telemetry scoped by `(workspaceId, projectId, recommendationId)`
- Learning signals scoped by `(workspaceId, projectId)`
- Profiles scoped by `(workspaceId, projectId)`

API test: `denies ID-substitution access on every project-scoped resource` verifies 14 endpoints.

---

## 13. Authentication / Authorization

**Status:** PASS

- Signup → session → workspace listing flow verified
- Bearer token authentication (with legacy x-apex-session header)
- Server-side session invalidation (logout destroys token immediately)
- Rate limiting on signup/login (5 attempts / 15 minutes)
- Failed signup attempts count toward brute-force budget
- Password hashing: scrypt with salt
- Session tokens: cryptographically random 256-bit

---

## 14. Database / Concurrency

**Status:** PASS (documented limitations)

DurableFileDatabase guarantees:

- ✅ Atomic commit (write to .tmp, then rename)
- ✅ Durability of committed transactions
- ✅ Strict structural domain validation at boundary
- ✅ Uniqueness & foreign-key constraints for committed records
- ✅ In-process write mutex for concurrent commits

**NOT provided (documented):**

- ✗ Cross-process serializability
- ✗ Read isolation during mid-transaction writes
- ✗ Row-level locking
- ✗ Crash recovery beyond last successful commit

---

## 15. Production Mock/Fallback Audit

**Status:** PASS

- LLM provider: `OPENAI_API_KEY` required in production; `SecurityError` thrown if missing
- `DevReasoningMockProvider` only used in development/test (NODE_ENV ≠ production)
- Token classification: only `ghp_`/`github_pat_`/`gho_`/`ghu_`/`ghs_`/`ghr_` prefixes trigger real clone
- GitHub adapter mock state reset at startup
- `shouldFallbackToMock` throws `SecurityError` in production
- Production clone failure → explicit error (no silent mock downgrade)

---

## 16. Frontend / Accessibility

**Status:** PASS (with documented limitation)

- All primary interactions use semantic `<button>` elements (not `<div onClick>`)
- Keyboard navigation: focus-visible rings on interactive elements
- `tabIndex` and `role` attributes where appropriate
- Screen-reader accessible names on buttons
- Epistemic badges on all H7 metrics (UNAVAILABLE/OBSERVED/DERIVED/etc.)
- No fabricated "1.42× measured leverage" — leverage only shown with real telemetry

**Full PM decision workflow (implemented in this final pass):** the Recommendation Center now exposes five explicit controls per recommendation:

- **Accept** — records ACCEPT telemetry
- **Accept & Execute** — approves the proposed action AND records ACCEPT telemetry
- **Reject** — records REJECT telemetry (the PM rejects the recommendation)
- **Defer** — records DEFER telemetry (the PM postpones)
- **Override** — a controlled numeric priority/rank input (0–10); records OVERRIDE telemetry with `pmSelectedPriority`

The client sends only: `decision`, `pmSelectedPriority` (OVERRIDE), `decisionStartedAt`, `decisionCompletedAt`, `recommendationPresentedAt`, `recommendationId`, `projectId`, `workspaceId`. The client NEVER sends `originalH3Score` / `calibratedH6Score` — those are computed server-side from the persisted H3 decoration and the compiled H6 profile.

**Decision latency semantics:** `recommendationPresentedAt` and `decisionStartedAt` are both set at mount time of the detail view (when the recommendation is presented to the PM and they begin their decision process). `decisionCompletedAt` is set when the PM submits their decision. This is semantically correct: the PM's decision window starts when they see the recommendation. All three timestamps share the client clock, so the measured latency is skew-free.

---

## 17. Observability

**Status:** PASS

- Structured JSON logging with `AsyncLocalStorage`-based request correlation
- `requestId` bound to logs via `Logger.withRequestId()`
- Concurrent requests cannot overwrite each other's logging context
- Sensitive fields redacted (passwords, tokens, API keys)
- `idempotencyKey` and `externalId` explicitly NOT redacted (audit trail)
- `X-Request-Id` header set on all responses

---

## 18. Dependency Security

**Status:** INFO

- `turbo@2.10.8`, `vitest@4.1.10`, `typescript@6.0.3`, `prettier@3.4.2`
- Node.js engine: `>=22`
- pnpm: `9.0.0`

---

## 19. Test Coverage

**Total: 56 test files, 666 tests (0 failed, 0 skipped — verified this pass)**

| Package          | Files | Tests |
| ---------------- | ----- | ----- |
| `@apex/ai-core`  | 48    | 590   |
| `@apex/analysis` | 3     | 36    |
| `@apex/prompts`  | 2     | 23    |
| `@apex/web`      | 3     | 17    |

**New tests added in the final pass:**

- `H7LearningEffect.test.ts` — **16 tests proving telemetry CHANGES H6 calibration** (not merely "telemetry exists"):
  - Scenario A — strong ACCEPT telemetry (N=20) shifts calibration deterministically vs no telemetry
  - Scenario B — systematic REJECT responds per the bounded rule (multiplier at the documented floor)
  - Scenario C / C2 — systematic OVERRIDE with a consistent delta is consumed; small corrections (Δ1) produce a measurably SMALLER adjustment than large ones (Δ6)
  - Scenario D — mixed behavior (40% ACCEPT / 30% REJECT / 20% DEFER / 10% OVERRIDE) is deterministic and bounded
  - Scenario E — 1–4 observations produce NO meaningful calibration shift
  - Scenario F — convergence boundary N = 4 / 5 / 19 / 20 gates the evidence exactly
  - Scenario G — high acceptance + high override rate + large delta is NOT blindly read as preference (ambiguity dampening, bounded output)
  - Safety floors under 100% rejection / 100% defer / 100% override / extreme delta / zero outcomes / failed outcomes / mixed signals (critical ≥ 8.5, high ≥ 7.0)
  - Acceptance population: `decisionAcceptanceRate = ACCEPT telemetry / total decision telemetry` with separate outcome/execution populations
  - Provenance: every telemetry-derived signal traces to exact persisted telemetry ids (`sourceTelemetryIds`)
  - Multi-tenant/multi-project isolation: workspace A/project A telemetry cannot influence workspace A/project B; same recommendationId across workspaces cannot contaminate
  - Domain ordering validation (presentation-after-decision-start rejected, nothing enters the store)
  - DECISION_LATENCY stays observational — never modifies calibration
- `apps/web/src/api-server.test.ts` — **1 new HTTP-boundary test** with 9 timestamp-integrity violations (presentedAt > startedAt, startedAt > completedAt, negative duration, startedAt/completedAt/presentedAt > serverNow + 5 min skew, duration > 24 h, non-ISO format, unparseable timestamp), each rejected with 400 and verified to never enter the telemetry stream.

Existing suites updated to the new contracts: acceptance-rate population (APEXProductService.audit, AdaptiveIntelligence, ProductDecisionValidation, ProductionProductization), calibration version `h6-v2`, and the h6-v2 multiplier bound (AdaptiveIntelligence adverse profile).

---

## 20. End-to-End Verification

The walking skeleton test (`VerticalWalkingSkeleton.test.ts`) verifies the complete flow:

1. Workspace creation
2. Project creation
3. Repository connection
4. Analysis run
5. Finding/recommendation generation
6. H3 scoring (deterministic)
7. Action approval
8. Action execution
9. Outcome creation

The API server test (`api-server.test.ts`) verifies:

1. Signup → session → workspace listing
2. Cross-tenant isolation (workspace B cannot read workspace A)
3. ID-substitution denial on 14 endpoints
4. Idempotent approval
5. Telemetry recording with all 4 decision types
6. Server-side session invalidation

**Live walking skeleton (this final pass, real HTTP server + durable on-disk DB):**

A real Vite dev server was started (`NODE_ENV=test`, `DATABASE_PATH=/tmp/apex-e2e-db`) and the full causal loop was exercised with `curl`:

1. signup → 2. workspace + project → 3. repository connection → 4. analysis → 5. recommendation (displayed with H3 score) → 6. ACCEPT / REJECT / DEFER / OVERRIDE (real telemetry ids `pmd-…` returned; OVERRIDE computed `overrideDelta = |H6 − 3|` server-side) → 7. H7 metrics (all four decision rates = 25%, latency = 60 s observed, mean override delta observed) → 8. compile H6 profile (`h6-v2`, signals carry `sourceTelemetryIds`) → 9. H6 calibration (dampened with insufficient evidence at N=4; explanation auditable) → 10. outcome create (PENDING) → 11. H5 verification (honest FAILED: "Codebase remains unconfigured: CI workflows are missing") → 12. updated profile/metrics.

**Causal-loop proof (N ≥ 5):** after 9 real ACCEPT decisions on the live server, the ACCEPTANCE signal became `observed` (n=9), the H7 confidence bucket moved to `early_convergence` ("5 ≤ N < 20 … NOT universal statistical significance"), and the calibration multiplier rose from **1.0 → 1.112** with `calibratedScore` 13.3 → 10 (clamped to [0,10]) and an explanation citing "H7 decision evidence over 9 telemetry decision(s): ACCEPT 100% → adjustment +0.142". Real PM behavior → real telemetry → auditable metrics → real signals → bounded calibration → observable change in prioritization.

**Persistence proof:** the durable DB file on disk contained the exact rows — 5 `pmDecisionTelemetry` (ACCEPT/REJECT/DEFER/OVERRIDE with window timestamps), 2 `learningSignals` (with `sourceTelemetryIds`), 1 `learningProfile`, 2 `outcomes`, 3 `recommendations`, 3 `actions`. Nothing was mocked in memory.

The strict-ISO validation was also observed live: 11 of 20 scripted submissions with single-digit minute components (e.g. `10:1:00`) were rejected with 400; the 9 well-formed submissions were accepted — the boundary rejects malformed timestamps rather than repairing them.

---

## 21. Findings Register

| ID  | Severity | Area     | Finding                                                                                                                   | Evidence                                                                                                  | Fix                                                                                                                                                                                                                             | Test                                                                |
| --- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| F01 | CRITICAL | H7→H6    | AdaptiveProfileCompiler did not consume PMDecisionTelemetry; REJECT/DEFER/OVERRIDE invisible to H6                        | Compiler only used actions/outcomes, never called `getPMDecisionTelemetryByProject`                       | Added telemetry consumption, generates REJECTION/DEFER/OVERRIDE/DECISION_LATENCY/PRIORITY_OVERRIDE_DELTA signals                                                                                                                | `H7MeasurementIntegrity.test.ts` (14 tests)                         |
| F02 | HIGH     | H7       | Confidence bucket used mixed population (recs + outcomes + actions) instead of decisionCount                              | `totalObservations = totalRecommendations + totalTrackedOutcomes + terminalActions`                       | Changed to `decisionCount` from telemetry stream                                                                                                                                                                                | `H7MeasurementIntegrity.test.ts` confidence bucket tests            |
| F03 | HIGH     | H7       | No server-side clock skew validation for client telemetry timestamps                                                      | API accepted any future timestamps                                                                        | Added 5-minute future skew limit, 24-hour max duration                                                                                                                                                                          | API server test existing + timestamp validation tests               |
| F04 | MEDIUM   | H6       | LearningSignal.type union declared REJECTION/IGNORED/CALIBRATION but never generated them                                 | Type defined but code only generated ADOPTION/EXECUTION_SUCCESS/OUTCOME_SUCCESS                           | Added generation for REJECTION/DEFER/OVERRIDE/DECISION_LATENCY/PRIORITY_OVERRIDE_DELTA                                                                                                                                          | Signal generation tests                                             |
| F05 | LOW      | Frontend | Frontend only records ACCEPT decisions; REJECT/DEFER/OVERRIDE not exposed in UI                                           | RecommendationsPanel only called `handleApprove` → ACCEPT                                                 | **FIXED (final pass)** — Accept / Accept & Execute / Reject / Defer / Override controls with numeric priority input; all four telemetry kinds recorded                                                                          | `RecommendationsPanel.tsx` + api-server decision-kind tests         |
| F06 | INFO     | Frontend | `presentedAt` and `startedAt` initialized simultaneously at mount time                                                    | `decisionWindowRef.current = { presentedAt: Date.now(), startedAt: Date.now() }`                          | **Not changed** — semantically correct: PM starts deciding when they see the recommendation                                                                                                                                     | Documented as intentional                                           |
| F07 | CRITICAL | H6→H7    | Calibrator used H7 signals only as gates; effective calibration still from pmCalibrationWeight + outcomeVerifiedRate      | `preferenceMultiplier = coef.pmCalibrationWeight` only; signal VALUES never entered the formula           | **FIXED** — h6-v2 contract: telemetry rates (ACCEPTANCE/REJECTION/DEFER/OVERRIDE) + signed override delta now adjust the multiplier deterministically, bounded [0.85, 1.15], with ambiguity dampening for contradictory signals | `H7LearningEffect.test.ts` (16 tests, scenarios A–G)                |
| F08 | HIGH     | H7       | Acceptance metric mixed populations: approved actions / total recommendations (not ACCEPT telemetry / decision telemetry) | `decisionAcceptanceRate` used `totalApproved / totalRecommendations`; same in `getDecisionQualityMetrics` | **FIXED** — acceptance = ACCEPT telemetry / decision telemetry, `observationCount = decisionCount`; added rejection/defer/override/delta metrics; execution & outcome populations kept separate                                 | `H7LearningEffect.test.ts` population test; updated existing suites |
| F09 | MEDIUM   | H7       | No `presentedAt <= startedAt` ordering enforcement; startedAt exempt from clock-skew policy; non-ISO timestamps accepted  | `new Date(v)` accepted any parseable string; skew checked only completedAt/presentedAt                    | **FIXED** — strict ISO-8601 regex at the API boundary; window ordering enforced at API + domain; skew policy applied to all three timestamps                                                                                    | `api-server.test.ts` 9-violation boundary test; domain test         |
| F10 | MEDIUM   | H6       | LearningSignal provenance could not trace to exact telemetry observations                                                 | `sourceRecommendationIds` alone is not unique for multi-decision records                                  | **FIXED** — typed `sourceTelemetryIds` (exact persisted telemetry ids) + `meanSignedOverrideDelta` on telemetry-derived signals                                                                                                 | `H7LearningEffect.test.ts` provenance test                          |

---

## 22. Remaining Issues

| Issue                                                                                                    | Classification                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentedAt = startedAt` at mount time                                                                  | **intentional epistemic limitation** — PM starts deciding when they see the recommendation                                                                      |
| H4 keyword-overlap grounding                                                                             | **intentional epistemic limitation** — documented in Part 7 of spec                                                                                             |
| Single-process database limitations                                                                      | **documented architectural limitation** — DATABASE.md explicitly narrows scope                                                                                  |
| No production GitHub clone without token                                                                 | **documented architectural limitation** — requires GITHUB_TOKEN                                                                                                 |
| Decision latency metric uses `decisionCompletedAt - decisionStartedAt` (not `completedAt - presentedAt`) | **intentional** — both use same client clock, skew-cancelling                                                                                                   |
| DECISION_LATENCY never influences calibration                                                            | **intentional** — the calibration contract defines no deterministic interpretation of latency (no "faster = better"); it stays auditable observational evidence |

---

## Files Changed (this final pass)

| File                                                                                                                                                                                                    | Change                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai-core/src/domain/entities/ProductAdaptive.ts`                                                                                                                                               | Added `ACCEPTANCE` signal type, `sourceTelemetryIds`, `meanSignedOverrideDelta` to `LearningSignal`                                                                                                     |
| `packages/ai-core/src/domain/entities/PMDecisionTelemetry.ts`                                                                                                                                           | Added strict window-ordering domain validation (`presentedAt <= startedAt <= completedAt`)                                                                                                              |
| `packages/ai-core/src/application/services/AdaptiveProfileCompiler.ts`                                                                                                                                  | h6-v2: ACCEPTANCE signal from telemetry; `sourceTelemetryIds` + `meanSignedOverrideDelta` on all telemetry-derived signals; `CALIBRATION_VERSION = 'h6-v2'`                                             |
| `packages/ai-core/src/application/services/H6PrioritizationCalibrator.ts`                                                                                                                               | **h6-v2 contract: consumes H7 signal VALUES** — telemetry valence, ambiguity dampening, signed override-delta correction; observed-only epistemic gate; full auditable explanation; bounds [0.85, 1.15] |
| `packages/ai-core/src/application/services/ProductValidationService.ts`                                                                                                                                 | Acceptance = ACCEPT telemetry / decision telemetry (`observationCount = decisionCount`); added rejection/defer/override/delta PM decision metrics; execution & outcome populations kept separate        |
| `packages/ai-core/src/application/services/RecommendationOutcomeService.ts`                                                                                                                             | `getDecisionQualityMetrics`: acceptance from telemetry population; decision/reject/defer/override counts added                                                                                          |
| `apps/web/src/api-server.ts`                                                                                                                                                                            | Strict ISO-8601 parsing; `presentedAt <= startedAt` rejection; clock-skew policy applied to all three timestamps                                                                                        |
| `apps/web/src/features/dashboard/components/RecommendationsPanel.tsx`                                                                                                                                   | Full PM decision workflow: Accept / Accept & Execute / Reject / Defer / Override (numeric priority input); all four telemetry kinds; client never sends H3/H6 scores                                    |
| `apps/web/src/features/dashboard/components/ValidationPanel.tsx`                                                                                                                                        | PM Decision Metrics group (acceptance/rejection/defer/override/delta/latency) + Outcome & Execution group                                                                                               |
| `apps/web/src/features/dashboard/types/index.ts`                                                                                                                                                        | New metric + decision-count fields                                                                                                                                                                      |
| `packages/ai-core/src/application/services/__tests__/H7LearningEffect.test.ts`                                                                                                                          | NEW: 16 tests — learning-effect scenarios A–G, safety-floor matrix, acceptance population, provenance, multi-tenant isolation, domain ordering, latency observational-only                              |
| `apps/web/src/api-server.test.ts`                                                                                                                                                                       | NEW: HTTP-boundary timestamp-integrity test (9 violation cases)                                                                                                                                         |
| `packages/ai-core/.../__tests__/{APEXProductService.audit,AdaptiveIntelligence,ProductDecisionValidation,ProductionProductization,H7MeasurementIntegrity,SqlAdaptiveLearningProfileRepository}.test.ts` | Updated to h6-v2 / telemetry-population contracts                                                                                                                                                       |

---

## FINAL DECISION GATE

**`H7 ENGINEERING + MEASUREMENT LOOP COMPLETE`**
**`H7 OBSERVATION READY`**
**`H8 BLOCKED`**

### Justification (every item verified from source, tests, and live runtime this pass):

- ✅ H7 telemetry is real and durable (PMDecisionTelemetryService + on-disk persistence verified in the live E2E)
- ✅ The PM UI supports all four decision kinds (Accept / Accept & Execute / Reject / Defer / Override with numeric priority)
- ✅ Acceptance metric = ACCEPT telemetry / decision telemetry — populations never mixed (PM Decision / Execution / Outcome)
- ✅ H6 consumes H7 signal VALUES deterministically (h6-v2): scenarios A–G tested, including contradictory signals and small-sample dampening
- ✅ DECISION_LATENCY is observational-only (no fabricated "faster = better" quality score)
- ✅ Timestamp integrity enforced at the domain AND HTTP boundary (ordering, ISO-8601, 3-timestamp skew policy, 24 h duration) — violations rejected, never repaired
- ✅ Full provenance: LearningSignal → `sourceTelemetryIds` → exact PM decisions → recommendation → project → workspace
- ✅ Epistemic safeguards intact: N < 5 / 5 ≤ N < 20 / N ≥ 20 ("high within the APEX operational measurement framework" — never universal statistical significance)
- ✅ Safety floors preserved under 100% rejection / defer / override / extreme delta / zero-failed outcomes / mixed signals
- ✅ Multi-tenant + multi-project isolation proven (telemetry, signals, profiles, calibration, metrics)
- ✅ End-to-end causal loop observed live: PM behavior → telemetry → metrics → signals → bounded calibration → observable prioritization change (multiplier 1.0 → 1.112)
- ✅ No fabricated values in production code (fallback/mock audit §15; all matches are documented-removed fabrications, infra defaults, or production-guarded dev mocks)
- ✅ All executable gates pass: type-check, lint, test (56 files / 666 tests, 0 failed), build, audit
- ✅ Frozen core byte-identical (SHA-256 verified)

### H8 remains BLOCKED because:

H8 must remain explicitly `H8 = BLOCKED` until genuine H7 empirical evidence accumulates from real PM interactions. The measurement infrastructure is complete and observation-ready; H8 work has not been started.
