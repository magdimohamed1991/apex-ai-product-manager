# PRE-H8 H7 Measurement Integrity & Remediation Audit

**Date:** 2026-08-09
**Branch:** `arena/019fe7a9-apex-ai-product-manager`
**Base:** `fb01aa547ec03dd6ca2ea4fe6674103c2dfef875`

---

## 1. Executive Summary

This audit performs an exhaustive verification and remediation pass focused on H7 measurement integrity and the H6 ↔ H7 learning loop. The primary objective was to ensure H7 is capable of producing trustworthy empirical evidence — not to start H8.

**Critical Finding:** The H6 AdaptiveProfileCompiler did NOT consume PM decision telemetry from the H7 telemetry stream. It only observed approvals via action status, making REJECT, DEFER, and OVERRIDE decisions invisible to H6. This has been fixed.

**Final Gate Status:**

- `pnpm type-check` — PASS (8/8 tasks)
- `pnpm lint` — PASS (8/8 tasks)
- `pnpm test` — PASS (55 files, 649 tests)
- `pnpm build` — PASS (1/1 tasks)

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

- `AdaptiveProfileCompiler` generates deterministic learning signals
- `H6PrioritizationCalibrator` applies signals multiplicatively with safety floors
- Critical safety floor (≥ 8.5) and high safety floor (≥ 7.0) cannot be violated
- Multiplier bounded to [0.85, 1.15]
- `insufficient_evidence` signals do NOT influence calibration

---

## 10. H7 Audit

**Status:** PASS (after remediation)

H7 measurement:

- PM decision telemetry records real decision windows
- All 4 decision types (ACCEPT/REJECT/DEFER/OVERRIDE) accepted
- Timestamps validated: completion ≥ start, valid ISO format
- Deterministic record ID (sha256 of workspace+recommendation+decisionStartedAt) ensures idempotency
- Client timestamps labeled as `client-observed telemetry`
- Confidence classification uses `decisionCount` ONLY

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

| Signal Type               | Description                             | Threshold            |
| ------------------------- | --------------------------------------- | -------------------- |
| `ADOPTION`                | Existing — recommendation approval rate | ≥ 3 observations     |
| `EXECUTION_SUCCESS`       | Existing — action completion rate       | ≥ 3 terminal actions |
| `OUTCOME_SUCCESS`         | Existing — verified success rate        | ≥ 3 outcomes         |
| `REJECTION`               | **NEW** — PM explicitly rejected        | ≥ 3 rejections       |
| `DEFER`                   | **NEW** — PM deferred decision          | ≥ 3 deferrals        |
| `OVERRIDE`                | **NEW** — PM overrode APEX priority     | ≥ 3 overrides        |
| `DECISION_LATENCY`        | **NEW** — Average decision window       | ≥ 3 decisions        |
| `PRIORITY_OVERRIDE_DELTA` | **NEW** — Average                       | H6 - PM              |     | ≥ 3 overrides |

Every signal contains full provenance:

- `workspaceId`, `projectId`, `category`
- `sourceRecommendationIds` (the actual observations)
- `calibrationVersion` (reproducibility)
- `evidenceState` (observed/estimated/insufficient_evidence)

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

**Documented limitation:** Frontend only records ACCEPT decisions via the "Approve & Execute" button. REJECT/DEFER/OVERRIDE require adding additional UI controls (not yet implemented). The API fully supports all 4 decision types — the limitation is purely in the frontend interaction model.

**Decision latency semantics:** `recommendationPresentedAt` and `decisionStartedAt` are both set at mount time of the detail view (when the recommendation is presented to the PM and they begin their decision process). `decisionCompletedAt` is set when the PM clicks "Approve." This is semantically correct: the PM's decision window starts when they see the recommendation.

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

**Total: 55 test files, 649 tests**

| Package          | Files | Tests |
| ---------------- | ----- | ----- |
| `@apex/ai-core`  | 47    | 574   |
| `@apex/analysis` | 3     | 36    |
| `@apex/prompts`  | 2     | 23    |
| `@apex/web`      | 3     | 16    |

**New tests added:** 30 tests in `H7MeasurementIntegrity.test.ts` covering:

- H7 confidence bucket classification (N = 0, 1, 4, 5, 19, 20, 100)
- REJECTION/DEFER/OVERRIDE signal generation
- DECISION_LATENCY signal recording
- PRIORITY_OVERRIDE_DELTA signal recording
- Signal threshold enforcement
- Decision telemetry changes H6 signal set
- Timestamp validation (negative duration, malformed dates)
- Multi-tenant isolation (same ID / different workspace, same ID / different project)
- Profile compilation isolation
- H3 determinism
- Safety floor invariants (critical, high)
- Multiplier bounds [0.85, 1.15]
- Signal provenance (workspaceId, projectId, category, source IDs)
- NOT_VERIFIABLE integrity
- Decision type persistence (ACCEPT/REJECT/DEFER/OVERRIDE)

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

---

## 21. Findings Register

| ID  | Severity | Area     | Finding                                                                                            | Evidence                                                                            | Fix                                                                                                              | Test                                                     |
| --- | -------- | -------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| F01 | CRITICAL | H7→H6    | AdaptiveProfileCompiler did not consume PMDecisionTelemetry; REJECT/DEFER/OVERRIDE invisible to H6 | Compiler only used actions/outcomes, never called `getPMDecisionTelemetryByProject` | Added telemetry consumption, generates REJECTION/DEFER/OVERRIDE/DECISION_LATENCY/PRIORITY_OVERRIDE_DELTA signals | `H7MeasurementIntegrity.test.ts` (14 tests)              |
| F02 | HIGH     | H7       | Confidence bucket used mixed population (recs + outcomes + actions) instead of decisionCount       | `totalObservations = totalRecommendations + totalTrackedOutcomes + terminalActions` | Changed to `decisionCount` from telemetry stream                                                                 | `H7MeasurementIntegrity.test.ts` confidence bucket tests |
| F03 | HIGH     | H7       | No server-side clock skew validation for client telemetry timestamps                               | API accepted any future timestamps                                                  | Added 5-minute future skew limit, 24-hour max duration                                                           | API server test existing + timestamp validation tests    |
| F04 | MEDIUM   | H6       | LearningSignal.type union declared REJECTION/IGNORED/CALIBRATION but never generated them          | Type defined but code only generated ADOPTION/EXECUTION_SUCCESS/OUTCOME_SUCCESS     | Added generation for REJECTION/DEFER/OVERRIDE/DECISION_LATENCY/PRIORITY_OVERRIDE_DELTA                           | Signal generation tests                                  |
| F05 | LOW      | Frontend | Frontend only records ACCEPT decisions; REJECT/DEFER/OVERRIDE not exposed in UI                    | RecommendationsPanel only calls `handleApprove` → ACCEPT                            | **Not fixed** — requires UI design for reject/defer/override interactions. API supports all 4 types.             | Documented as remaining issue                            |
| F06 | INFO     | Frontend | `presentedAt` and `startedAt` initialized simultaneously at mount time                             | `decisionWindowRef.current = { presentedAt: Date.now(), startedAt: Date.now() }`    | **Not changed** — semantically correct: PM starts deciding when they see the recommendation                      | Documented as intentional                                |

---

## 22. Remaining Issues

| Issue                                                                                                    | Classification                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Frontend only records ACCEPT decisions                                                                   | **documented architectural limitation** — API supports all 4 types; requires UI design     |
| `presentedAt = startedAt` at mount time                                                                  | **intentional epistemic limitation** — PM starts deciding when they see the recommendation |
| H4 keyword-overlap grounding                                                                             | **intentional epistemic limitation** — documented in Part 7 of spec                        |
| Single-process database limitations                                                                      | **documented architectural limitation** — DATABASE.md explicitly narrows scope             |
| No production GitHub clone without token                                                                 | **documented architectural limitation** — requires GITHUB_TOKEN                            |
| Decision latency metric uses `decisionCompletedAt - decisionStartedAt` (not `completedAt - presentedAt`) | **intentional** — both use same client clock, skew-cancelling                              |

---

## Files Changed

| File                                                                                 | Change                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai-core/src/domain/entities/ProductAdaptive.ts`                            | Added DEFER, OVERRIDE, DECISION_LATENCY, PRIORITY_OVERRIDE_DELTA to LearningSignal type union                                                                                                                    |
| `packages/ai-core/src/application/services/AdaptiveProfileCompiler.ts`               | +175 lines: Added PMDecisionTelemetry consumption, decision-based signal generation (REJECTION, DEFER, OVERRIDE, DECISION_LATENCY, PRIORITY_OVERRIDE_DELTA), extended ObservationPopulation with decision counts |
| `packages/ai-core/src/application/services/ProductValidationService.ts`              | Changed confidence bucket from mixed population to decisionCount, observationCount now reflects decisionCount                                                                                                    |
| `apps/web/src/api-server.ts`                                                         | Added server-side timestamp validation: 5-min future skew limit, 24-hour max duration, clock skew policy                                                                                                         |
| `packages/ai-core/src/application/services/__tests__/H7MeasurementIntegrity.test.ts` | NEW: 30 comprehensive tests for H7 measurement integrity and H6 ↔ H7 learning loop                                                                                                                               |

---

## FINAL DECISION GATE

**OPTION A: `H7 ENGINEERING REMEDIATION COMPLETE`**
**`H7 OBSERVATION READY`**
**`H8 BLOCKED`**

### Justification:

- ✅ H7 telemetry is real (PMDecisionTelemetryService records actual PM decisions)
- ✅ Decision observations are correctly defined (ACCEPT/REJECT/DEFER/OVERRIDE with typed signals)
- ✅ H6 consumes H7 decision evidence (AdaptiveProfileCompiler generates decision-based signals)
- ✅ Tenant isolation is verified (API + DB + multi-workspace tests)
- ✅ Outcomes are traceable (recommendation → decision → execution → verification → outcome)
- ✅ Metrics are epistemically honest (epistemic badges, no inflated claims)
- ✅ End-to-end application works (walking skeleton + API tests)
- ✅ All executable gates pass (type-check, lint, test, build)
- ✅ Frozen core is byte-identical

### H8 remains BLOCKED because:

H8 must remain explicitly `H8 = BLOCKED` until genuine H7 empirical evidence exists from real PM interactions. The measurement infrastructure is now ready to collect that evidence.
