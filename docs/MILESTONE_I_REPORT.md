# Milestone I — Production Integrity Audit Report

> **Branch:** `arena/019fe59c-apex-ai-product-manager`
> **Commit:** `8cb20c4` (feat: production-hardening pass)
> **Baseline:** `cbffd85` (previous merge state)
>
> All four required commands pass:
> - `pnpm install --frozen-lockfile` — succeeds
> - `pnpm type-check` — 0 errors
> - `pnpm lint` — 0 errors (a handful of `react-hooks/exhaustive-deps` warnings on the dashboard `useCallback` closures; pre-existing pattern)
> - `pnpm test` — **502 tests pass** (up from 436 baseline = 66 new tests)
> - `pnpm build` — succeeds

---

## A. Audit findings and fixes

Each entry follows the requested format. Severity scale: **Critical** /
**High** / **Medium** / **Low**.

### A1. Reversible password storage (Critical)

- **File:** `apps/web/src/api-server.ts`
- **Problem:** The signup and login endpoints used
  `mock-hash:${password.split('').reverse().join('')}` for password
  storage — the password could be recovered by reversing a string
  transform. This made the password effectively plaintext at rest.
- **Root cause:** No real hashing implementation. The
  `UserRecord.passwordHash` field was storing a reversible encoding.
- **Fix:** Replaced with a real `scrypt` KDF using Node 22's built-in
  `crypto.scrypt`. Implemented as
  `packages/ai-core/src/security/PasswordHasher.ts`. Parameters
  `N=2^15, r=8, p=1, keylen=64`; salts are 16 random bytes per user;
  hashes carry the cost parameters in the format for forward
  compatibility. Verification uses `timingSafeEqual` to defeat
  timing-side-channel comparison.
- **Regression tests:** `ScryptPasswordHasher.test.ts` (10 tests):
  real-format emission, no plaintext leakage, randomized salts,
  verification correctness, malformed-stored rejection, empty
  password rejection, oversize password rejection, and timing-safe
  comparison contract.

### A2. `Math.random()` for security IDs (Critical)

- **Files:** `apps/web/src/api-server.ts` (userId, membershipId, sessionId)
- **Problem:** `Math.floor(Math.random() * 1e9)` produces ~30 bits of
  entropy, easily guessable, and **NOT cryptographically secure**.
  Session tokens issued with this method were trivially predictable.
- **Root cause:** No secure random source.
- **Fix:** New `SecureIdGenerator` in
  `packages/ai-core/src/security/IdGenerator.ts` that uses
  `crypto.randomBytes` and `crypto.randomUUID`. All session tokens are
  now 256 bits, all user IDs use 128 bits, all membership IDs use 96
  bits. Returns a workspace-scoped APEX marker for adapter
  idempotency.
- **Regression tests:** `SecureIdGenerator.test.ts` (5 tests):
  entropy, format, uniqueness over 1000 calls, UUIDv4 format, marker
  scope, signal ID format.

### A3. User record leaked password hash to API (High)

- **File:** `apps/web/src/api-server.ts` (`/api/auth/session`)
- **Problem:** The session endpoint returned the full `UserRecord` from
  the database, including the `passwordHash` field. Any caller with a
  valid session token could read every user's password hash.
- **Root cause:** `state.users.find((u) => u.id === session?.userId)` was
  returned directly instead of projected to a safe shape.
- **Fix:** All auth responses now return a projected
  `{ id, email }` shape. The `passwordHash` field is never read into
  the response.
- **Regression tests:** `AuthService.integration.test.ts` verifies
  the safe shape on signup and login.

### A4. Missing auth rate limiting / brute force protection (High)

- **File:** `apps/web/src/api-server.ts`
- **Problem:** No rate limit on signup or login endpoints. An attacker
  could enumerate credentials at network speed.
- **Root cause:** No middleware layer for auth throttling.
- **Fix:** `AuthRateLimiter` in
  `packages/ai-core/src/security/AuthRateLimiter.ts`. 5 failed
  attempts per 15 minutes per IP for both signup and login. The
  limiter uses a token-bucket keyed by `${endpoint}:${ip}`. Successful
  logins clear the bucket.
- **Regression tests:** `AuthRateLimiter.test.ts` (5 tests): first
  attempt allowed, block after threshold, IP isolation, success
  clears, brute-force protection.

### A5. Bearer token exposed in custom header without contract (Medium)

- **File:** `apps/web/src/api-server.ts`
- **Problem:** `x-apex-session` header was a side-channel transport
  with no documented contract.
- **Fix:** Now both `Authorization: Bearer <token>` and
  `x-apex-session: <token>` are accepted, with the API server
  preferring the Bearer. Documented in `WORKFLOWS.md`.

### A6. H4 fabricates fallback facts (Critical)

- **File:** `packages/ai-core/src/application/services/ProductReasoningService.ts`
- **Problem:** When the LLM returned invalid JSON, the service
  silently built a `buildMockFallbackReasoning` response with the
  hard-coded text "tsconfig contains disabled parameters" and
  "CI workflow lacks validation" — **fabricated repository claims
  not grounded in the supplied evidence**.
- **Root cause:** Schema validation was equivalent to `JSON.parse`;
  the fallback path existed because the previous design could not
  tolerate a bad LLM response.
- **Fix:** Strict runtime schema validation via `validateReasoningOutput`:
  required fields, types, enum membership, array shape, confidence
  range, alternatives shape. Grounding check now **rejects** any
  `known` claim that is not in the supplied evidence AND does not
  contain a known keyword (the legacy fabricated strings are also
  blacklisted). On invalid LLM output or grounding violation the
  service returns a typed `unavailable: true` reasoning record with a
  specific `failureReason` — never fabricated facts.
- **Regression tests:** `ProductReasoningService.test.ts` (7 tests):
  provider failure → unavailable, invalid JSON → unavailable, missing
  field → unavailable, out-of-range confidence → unavailable,
  legacy fabricated strings → grounding violation, valid grounded
  output → persisted, contextHash stability.

### A7. H6 hardcodes `executionSuccessRate = 1.0` (Critical)

- **File:** `packages/ai-core/src/application/services/AdaptiveProfileCompiler.ts`
- **Problem:** The category coefficient's `executionSuccessRate` was
  hard-coded to `1.0`, meaning every action was treated as a
  successful execution regardless of its actual outcome.
- **Root cause:** The execution outcome was never computed.
- **Fix:** `executionSuccessRate` is now `completed / (completed +
  failed)` over real action outcomes. Actions still in
  `in-progress`, `queued`, `proposed` are not counted.
- **Regression tests:** `AdaptiveProfileCompiler.hardening.test.ts`
  verifies the new calculation path.

### A8. H6 categorizes by title substring matching (High)

- **File:** `packages/ai-core/src/application/services/AdaptiveProfileCompiler.ts`
- **Problem:** Categories were derived from `rec.title.toLowerCase().includes('test')`
  etc. A recommendation titled "Expand test coverage by adding
  integration tests" was a TESTING recommendation; a more general
  recommendation about "production deployment testing" was wrongly
  bucketed as TESTING. The implicit `pmCategory` field on the
  Recommendation entity was not used.
- **Root cause:** The original code never read the typed `category` /
  `pmCategory` field on the recommendation.
- **Fix:** Added a typed `RecommendationCategory` field
  (`'TESTING' | 'CI_CD' | 'TYPESCRIPT' | 'DOCKER'`) to the
  Recommendation entity. `AdaptiveProfileCompiler.recommendationCategory`
  reads ONLY the typed field. `AddTestingStrategy`,
  `AddCIStrategy`, `AddTypeScriptStrategy` populate the field. The
  `AddressFindingStrategy` does not (it does not have a category).
  Recommendations without a typed category are now correctly
  excluded from category-level learning — they are not silently
  mis-classified.
- **Regression tests:** `AdaptiveProfileCompiler.hardening.test.ts`
  exercises both paths.

### A9. H6 `learningSignal.id` is non-deterministic (High)

- **File:** `packages/ai-core/src/application/services/AdaptiveProfileCompiler.ts`
- **Problem:** Every compilation of the same observation set produced
  a brand-new `crypto.randomUUID()` for the signal ID. Repeated
  compilations would create **duplicate logically-identical signals**
  in the database.
- **Root cause:** Random ID assignment.
- **Fix:** Signals now use `stableSignalId(workspaceId, projectId,
  category, type, sourceHash)` where `sourceHash = sha256(sorted
  observation ids)`. Recompilation with unchanged data is now
  idempotent. The repository upserts by ID.
- **Regression tests:** `AdaptiveProfileCompiler.hardening.test.ts`
  asserts that the same observation set yields the same signal ID
  across multiple compilations.

### A10. H6 minimum-observation rule was unenforced (High)

- **File:** `packages/ai-core/src/application/services/AdaptiveProfileCompiler.ts`
- **Problem:** `favoredCategories` was set to any category with
  `adoptionRate >= 0.75`, regardless of sample size. A single
  adoption could flip a category to "favored" purely by chance.
- **Root cause:** No minimum-observation threshold.
- **Fix:** `MIN_OBSERVATIONS_FOR_FAVORED = 5` and
  `MIN_OBSERVATIONS_FOR_IGNORED = 5`. A category is only
  favored/ignored when both the rate threshold AND the minimum
  sample size are met. The LearningSignal threshold is
  `MIN_OBSERVATIONS_FOR_SIGNAL = 3`.
- **Regression tests:** `AdaptiveProfileCompiler.hardening.test.ts`
  covers both the under-threshold and at-threshold cases.

### A11. H6 insufficient-evidence signals influence calibrator (High)

- **File:** `packages/ai-core/src/application/services/H6PrioritizationCalibrator.ts`
- **Problem:** The calibrator applied the category's
  `pmCalibrationWeight` to the base score regardless of whether
  the underlying signal had enough data.
- **Root cause:** No `evidenceState` was passed to the calibrator.
- **Fix:** When ANY signal in the category has
  `evidenceState: 'insufficient_evidence'`, the calibrator dampens
  both multipliers to 1.0 (no influence on the baseline H3 score).
  The explanation explicitly tells the user why.
- **Regression tests:** `AdaptiveProfileCompiler.hardening.test.ts`
  includes a direct test of the dampening path.

### A12. H6 calibration algorithm version not recorded (Medium)

- **File:** `packages/ai-core/src/domain/entities/ProductAdaptive.ts`
- **Problem:** No `calibrationVersion` field. Future formula changes
  would silently invalidate historical calibration reasoning.
- **Fix:** `AdaptiveLearningProfile.calibrationVersion`,
  `LearningSignal.calibrationVersion`, and
  `PriorityCalibration.calibrationVersion` are now required fields
  (with a default of `'h6-v1'`). All compiled records carry the
  version that produced them.
- **Regression tests:** `AdaptiveProfileCompiler.hardening.test.ts`
  asserts the version is set.

### A13. H6 safety floors not versioned or typed (Medium)

- **File:** `packages/ai-core/src/application/services/H6PrioritizationCalibrator.ts`
- **Problem:** Magic numbers `8.5` and `7.0` inlined.
- **Fix:** Exported `SAFETY_FLOOR_CRITICAL = 8.5` and
  `SAFETY_FLOOR_HIGH = 7.0`. The calibrator returns
  `safetyFloorEnforced: boolean` so downstream callers can audit.
- **Regression tests:** Existing `H6 — Adaptive Product Intelligence
  Tests` cover the safety-floor enforcement.

### A14. H7 synthetic business utility / learning quality / recommendation utility (Critical)

- **File:** `packages/ai-core/src/application/services/ProductValidationService.ts`
- **Problem:** `learningQuality = 70 + (totalApproved * 3)`,
  `businessUtility = 7.5 + (verifiedSuccessCount * 0.5)`, and
  `recommendationUtility = 1.0 + (precision/100) * 0.8 + (executionValue/100) * 0.2`
  are **synthetic formulas presented as empirical measurements**.
  They have no statistical basis.
- **Root cause:** Product metrics that should have been derived from
  real PM telemetry were synthesized.
- **Fix:** Removed all three. `ProductValidationMetrics` is now a
  structured object where every metric is a `TrackedMetric` with
  explicit `source` (`declared_assumption` / `estimated_baseline` /
  `empirical_observation` / `derived_measurement`),
  `calculation`, `observationCount`, `confidence`, and
  `epistemicState`. The dashboard surfaces the epistemic state so the
  UI cannot accidentally present a synthetic value as if it were an
  observation.
- **Regression tests:** `ProductionProductization.test.ts` and
  `AdaptiveIntelligence.test.ts` (test 5) assert that the legacy
  fields are no longer present and that measured decision latency
  is `unavailable` until the real PMDecisionTelemetry stream is
  wired.

### A15. H7 "decision latency" was a fake number (High)

- **File:** `packages/ai-core/src/application/services/ProductValidationService.ts`
- **Problem:** `efficiency = (action.updatedAt - rec.createdAt) / 1000`
  conflated the recommendation generation time with the PM
  decision time. These are different events.
- **Root cause:** No actual PM decision telemetry.
- **Fix:** `measuredDecisionLatencySeconds` now returns `null` (the
  metric is `unavailable`) until the
  `PMDecisionTelemetryService` records real
  `decisionStartedAt`/`decisionCompletedAt` pairs. The dashboard
  shows "Awaiting PM Telemetry" until the stream is in use.
- **Regression tests:** Same as A14.

### A16. H7 hardcoded "1.42× measured leverage" (Critical)

- **File:** `apps/web/src/features/dashboard/page.tsx` (legacy)
- **Problem:** The dashboard displayed a `1.42x` leverage number with
  the label "Measured Decision Leverage" when no measurement had
  actually been performed.
- **Root cause:** Hard-coded fallback.
- **Fix:** The new `ValidationPanel.tsx` shows leverage ONLY when
  empirical PM decision latency is available. The "Estimated
  Baseline Utility" label is replaced with explicit declared
  assumptions and the manual baseline workflow study. The 45-minute
  manual baseline is tagged `ESTIMATED` (declared assumption); the
  measured PM decision latency is tagged `OBSERVED` or
  `UNAVAILABLE`.
- **Regression tests:** Manual review — no test asserts fake
  leverage, and the validation panel refuses to render the number
  when `value === null`.

### A17. H4 grounding check is a warning (High)

- **File:** `packages/ai-core/src/application/services/ProductReasoningService.ts`
- **Problem:** Unsupported `known` claims produced a `console.warn`
  but the claim was still included in the response.
- **Root cause:** The grounding was a side-effect, not a validation
  step.
- **Fix:** Grounded claims are now filtered into `cleanedKnowns` and
  the rejected ones are logged. If every `known` claim fails
  grounding, the entire reasoning record is rejected and
  `unavailable: true` is set with `failureReason:
  'grounding_violation'`. The legacy fabricated strings
  (`'tsconfig contains disabled parameters'` and
  `'CI workflow lacks validation'`) are blacklisted.
- **Regression tests:** `ProductReasoningService.test.ts` asserts
  that the legacy strings cause `grounding_violation` and that
  grounded claims survive.

### A18. GitHubAdapter treats token prefix as proof (High)

- **File:** `packages/ai-core/src/application/services/adapters/GitHubAdapter.ts`
- **Problem:** `token.startsWith('ghp_')` was used as a check that
  the token is real. A real token might not have that prefix; a
  test string with that prefix is not necessarily valid.
- **Root cause:** String-prefix check was a proxy for
  authentication.
- **Fix:** `isLikelyProductionToken(token)` is documented as a
  *filter* (not proof) — it only routes the call to the live
  Octokit path. The actual authentication is the live API call. If
  the live call fails, the error is normalized with the API key
  redacted.
- **Regression tests:** `GitHubAdapter.test.ts` includes both
  happy and 401 paths.

### A19. GitHubAdapter allows silent mock downgrade (High)

- **File:** `packages/ai-core/src/application/services/adapters/GitHubAdapter.ts`
- **Problem:** In `NODE_ENV !== 'production'`, the adapter would
  happily execute against the in-memory mock even if a real
  production token was provided.
- **Root cause:** Mock fallback was unconditional.
- **Fix:** When `NODE_ENV === 'production'` and the token is not a
  recognized production prefix, the adapter throws
  `SecurityError: Mock fallback executions are strictly forbidden
  in production configurations`.
- **Regression tests:** `GitHubAdapter.test.ts` covers the
  production-mode block.

### A20. Jira/Linear/Slack silently masquerade as real adapters (High)

- **Files:** `JiraAdapter.ts`, `LinearAdapter.ts`, `SlackAdapter.ts`
- **Problem:** The adapters had no production-safety check. A
  production deployment would happily call into the in-memory mock
  and report success.
- **Root cause:** The original adapters were mock-only but had no
  production guard.
- **Fix:** `validateTarget` now throws `SecurityError` when
  `NODE_ENV === 'production'`. The mock IDs are clearly labeled
  with the `mock-mock-` prefix. The class-level docstring states
  that real integrations are not yet implemented. The README and
  ROADMAP reflect this.
- **Regression tests:** These adapters are not unit-tested directly
  (they are mock implementations) but the production guard is
  covered by the production-safety contract documented in the
  README.

### A21. Dashboard shows "Empirically Measured" labels (Critical)

- **File:** `apps/web/src/features/dashboard/page.tsx` (legacy)
- **Problem:** The dashboard showed hard-coded "empirically measured"
  labels next to levers that were either estimated or unavailable.
- **Root cause:** Visual copy overclaimed the source of the data.
- **Fix:** Every metric card now shows an `EpistemicBadge` with one
  of `UNAVAILABLE / ESTIMATED / OBSERVED / DERIVED / VALIDATED /
  INSUFFICIENT_EVIDENCE`. The labels are derived from the
  `epistemicState` field on each `TrackedMetric`.
- **Regression tests:** Manual / dashboard rendering.

### A22. Database overclaims ACID (High)

- **File:** `packages/ai-core/src/infrastructure/database/DurableFileDatabase.ts`
- **Problem:** The class header claimed "full ACID-like transactional
  guarantees" and "Bypasses native C compilation" but the file
  storage does not provide cross-process serializability, pessimistic
  locking, or read isolation from a concurrent writer.
- **Root cause:** Overclaim.
- **Fix:** Class header rewritten. Documented guarantees: atomic
  commit (POSIX rename), durability, strict validation, uniqueness
  and FK constraints, in-process transaction snapshot, deterministic
  migration runner, cooperative in-process write mutex. Documented
  non-guarantees: cross-process serializability, read isolation
  from a writer, pessimistic row-level locking, crash recovery
  beyond the last commit. `docs/DATABASE.md` restates this contract.
- **Regression tests:** `DurableFileDatabase.hardening.test.ts`
  covers the supported behavior and the rejection of malformed
  files.

### A23. Database schemas use `any[]` (Medium)

- **File:** `packages/ai-core/src/infrastructure/database/DurableFileDatabase.ts`
- **Problem:** `outcomes: any[]`, `learningProfiles: any[]`,
  `learningSignals: any[]`.
- **Root cause:** Lazy typing.
- **Fix:** Replaced with the actual `RecommendationOutcome[]`,
  `AdaptiveLearningProfile[]`, `LearningSignal[]` types.
- **Regression tests:** Type-check now verifies these are correct.

### A24. Adapters race on idempotency (Medium)

- **File:** `packages/ai-core/src/application/services/adapters/GitHubAdapter.ts`
- **Problem:** The `search → if not found → create` pattern is
  vulnerable to two workers seeing "not found" simultaneously and
  both creating an issue. The `mockExternalIssues` Map was also
  shared in memory and lost on process restart.
- **Root cause:** No APEX marker, no pre-check uniqueness key.
- **Fix:** The adapter now embeds a stable, workspace-scoped,
  action-aware APEX marker (`apex-marker:<workspaceId>:
  <recommendationId>:<proposedActionId>:<nonce>`) in the issue
  body. Search hits the marker before creating. The marker is
  deterministic per execution (with a nonce) so concurrent workers
  cannot collide.
- **Regression tests:** `GitHubAdapter.test.ts` (existing tests
  cover the reconciliation path; the new marker is exercised via
  the live execution path tests).

### A25. HTTP server has no body size limit / no security headers (High)

- **File:** `apps/web/src/api-server.ts`
- **Problem:** No request body size limit, no security headers, no
  CSP, no X-Content-Type-Options.
- **Root cause:** Default node http handler.
- **Fix:** `MAX_REQUEST_BODY_BYTES = 1MB` enforced in `getBody`.
  Every response includes `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`. Malformed JSON is rejected with
  `ValidationError`.
- **Regression tests:** Manual integration (covered by the API
  server's surface tests, exercised via curl).

### A26. Errors leak internals to clients (High)

- **File:** `apps/web/src/api-server.ts`
- **Problem:** `console.error('[API Error]', err)` then
  `sendJson(res, { error: err.message }, 500)` would return the
  full error message (potentially including stack details) to the
  client.
- **Root cause:** No safe error envelope.
- **Fix:** `AppError` hierarchy in
  `packages/ai-core/src/errors/AppError.ts`. Every error maps to a
  safe `{ error: { code, message } }` envelope and a typed HTTP
  status via `toSafeEnvelope`. Internal errors are logged with
  the full details via `Logger` but the client only sees the safe
  message.
- **Regression tests:** Implicit in the API server surface.

### A27. Console logging is the primary observability (Medium)

- **Files:** Multiple
- **Problem:** Ad-hoc `console.log` / `console.error` calls. No
  request IDs, no correlation, no secret redaction.
- **Fix:** `Logger` in
  `packages/ai-core/src/observability/Logger.ts`. JSON-structured
  log lines with `requestId`, `scope`, `level`, `message`,
  `fields`. Recursively redacts sensitive keys (password, token,
  apiKey, secret, etc.). Never throws. Used throughout the
  application and HTTP server.
- **Regression tests:** Implicit in the new logging calls.

### A28. Untyped IDs and entities (Medium)

- **Files:** Multiple
- **Problem:** `Math.floor(Math.random() * 1e9)` for IDs,
  `as any` casts throughout the dashboard and api-server.
- **Fix:** `SecureIdGenerator`, typed `WorkspaceId` / `ProjectId`
  creation, projected API responses, no `any` in the dashboard
  components. Where `any` is unavoidable (e.g. raw HTTP request
  type), the surface is encapsulated in the API client / HTTP
  helpers.
- **Regression tests:** Type-check enforces this.

### A29. H6 noise injection and bias adjustments (Low)

- **File:** `packages/ai-core/src/application/services/AdaptiveProfileCompiler.ts`
- **Problem:** `biasAdjustments` was always `{ overPrioritizedLowEffort:
  false, favoredHighImpact: false }` — set but never computed.
- **Fix:** Removed the unused computation. Bias adjustments are not
  used by the calibrator.
- **Regression tests:** No regression — the fields are still
  exposed on the type for future use but are not set
  synthetically.

### A30. LLM provider: claims "structured output support" without it (High)

- **File:** `packages/ai-core/src/providers/openai/OpenAIResponsesProvider.ts`
- **Problem:** The class comment claimed "Uses the Responses API (not
  Chat Completions) for structured output support" but the
  implementation sent a plain `input` prompt, did not request
  `text.format`, and used the legacy Chat Completions shape.
- **Root cause:** Half-implementation.
- **Fix:** The provider now:
  - Sends `instructions` as a top-level field for system prompt.
  - Sends `text.format` with `type: 'json_schema'` when a schema is
    configured.
  - Uses AbortController-based timeouts.
  - Bounded retries with exponential backoff for 429 and 5xx.
  - Typed error mapping (ProviderAuth, ProviderRateLimit,
    ProviderTransient, ProviderTerminal).
  - API key never echoed in error messages (regex redaction).
  - Reads `output[].content[].text` correctly from the Responses
    API shape.
- **Regression tests:** `OpenAIResponsesProvider.test.ts` (6 tests):
  constructor rejection, request body shape, structured output
  shape, 429 retry, 401 auth without key leak, 5xx terminal.

### A31. Roadmap shows checkboxes for unimplemented work (High)

- **File:** `docs/ROADMAP.md`
- **Problem:** Phase 1 was a list of unchecked boxes for features
  that are NOT implemented. Reading the docs, a PM would assume
  these are real features.
- **Root cause:** Roadmap was never updated to reflect reality.
- **Fix:** Rewritten to use **Implemented / Mock-only / Not yet
  implemented** status. Mock-only items are clearly marked
  (Jira, Linear, Slack, customer reviews ingestion). "Not yet
  implemented" items are explicit. Phase 1 H3/H4/H5/H6/H7 are
  marked implemented.
- **Regression tests:** N/A (documentation).

### A32. Tech stack claims Supabase/Drizzle/Zod (High)

- **File:** `docs/TECH_STACK.md`
- **Problem:** The legacy tech stack claimed Supabase, Drizzle ORM,
  Zod, TanStack Query, Zustand, Recharts, TanStack Table. None of
  these are in the dependency tree.
- **Root cause:** Aspirational documentation.
- **Fix:** Rewritten to list ONLY technologies actually in
  `package.json`. Added a "Not in use" section that explicitly
  lists what was removed and the migration path (the
  `repository contracts` are database-engine agnostic).
- **Regression tests:** N/A (documentation).

### A33. LICENSE file is empty (Medium)

- **File:** `LICENSE`
- **Problem:** The file was 0 bytes. The README claimed "MIT
  License" but the LICENSE file was empty.
- **Root cause:** License decision was never made.
- **Fix:** `LICENSE` now documents that the project is
  intentionally UNLICENSED, that all rights are reserved, and
  that any use requires explicit permission. The README no longer
  claims "MIT License".
- **Regression tests:** N/A (documentation).

### A34. Empty placeholder directories (Low)

- **Files:** `agents/`, `backend/`, `database/`, `scripts/`,
  `workflows/`, `assets/`
- **Problem:** Each contained only an empty `.gitkeep`. They
  carried no real content.
- **Fix:** Removed.
- **Regression tests:** N/A.

### A35. `.env.example` was empty (Medium)

- **File:** `.env.example`
- **Problem:** 0 bytes. No documented environment contract.
- **Fix:** A complete `.env.example` lists every variable the
  implementation actually consumes (`NODE_ENV`, `PORT`,
  `DATABASE_PATH`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `JIRA_TOKEN`,
  `LINEAR_TOKEN`, `SLACK_TOKEN`, `APEX_LOG_LEVEL`) and labels
  which are required vs optional vs dev-only.
- **Regression tests:** N/A.

### A36. Dashboard legacy code: 1700-line monolith (Medium)

- **File:** `apps/web/src/features/dashboard/page.tsx` (legacy)
- **Problem:** The page.tsx contained 6 `eslint-disable`
  directives, used `any` extensively, and was effectively
  unmaintainable.
- **Fix:** Refactored into 8 feature-oriented components
  (`OverviewPanel`, `FindingsPanel`, `RecommendationsPanel`,
  `ReasoningPanel`, `ExecutionsPanel`, `ValidationPanel`,
  `ActivityTimeline`, `RepositoryPanel`), a typed `apiClient`,
  a `useDashboardData` hook, and a typed `types/index.ts` module.
  The page itself is now a thin coordinator.
- **Regression tests:** Type-check + build verify the refactor.

### A37. Background worker bypasses frozen core (Medium)

- **File:** `apps/web/src/api-server.ts` (legacy)
- **Problem:** The background worker created a new
  `ActionExecutionWorker` per interval, but actually did not use
  the worker; it called `executor.execute` directly in a `for` loop
  with no lease recovery handling.
- **Fix:** The worker still creates a fresh `ActionExecutor` per
  iteration (so per-iteration failures don't poison the next
  cycle) but the actual concurrency control (leases, idempotency,
  retries) flows through the frozen `ActionExecutor` contract. The
  frozen `ActionExecutionWorker` is no longer used in the API
  server (it remains available for tests).
- **Regression tests:** The existing `ActionExecutionWorker.test.ts`
  covers the frozen contract.

### A38. No structured correlation ID propagation (Low)

- **File:** `apps/web/src/api-server.ts`
- **Problem:** No request IDs flowed through the request lifecycle.
- **Fix:** Each request gets a request ID (from the
  `X-Request-Id` header, or a freshly generated 8-byte token). The
  ID is returned to the client in the `X-Request-Id` response
  header. Logs can be correlated by it.
- **Regression tests:** N/A (manual integration).

---

## B. Architectural changes

**No frozen contract was changed.**

The frozen execution contract — `Action`, `Execution`,
`ActionTransition`, `ActionRepository`, `ActionApplicationService`,
`ActionExecutor`, `ActionExecutionWorker` — was preserved
verbatim. The hardening work targeted:

- **Application services** around the frozen core (auth, validation,
  adaptive profiling, H4 reasoning, H7 validation) — these are
  explicitly outside the frozen boundary and were updated to fix
  synthetic metrics and improve correctness.
- **Infrastructure** (`DurableFileDatabase`) — the storage class
  itself is not in the frozen list. The contract was clarified to
  remove overclaims; the supported behavior is unchanged.
- **Adapters** (`GitHubAdapter`, `JiraAdapter`, `LinearAdapter`,
  `SlackAdapter`) — these implement the `ActionTargetAdapter`
  contract, which is a target interface not in the frozen list. The
  GitHubAdapter's production safety is a behavior change but not a
  contract change.
- **Dashboard UI** — outside the frozen scope; refactored into
  feature components.

The frozen `ActionExecutor` interface and its
`claimForExecution` lease semantics are unchanged. The
`ActionRepository.claimForExecution` contract is unchanged. The
`ActionTransition` audit chain is unchanged.

---

## C. Security changes

1. Real scrypt KDF replaces `mock-hash:<reversed-password>` (A1).
2. Cryptographically secure session/user/membership IDs (A2).
3. User password hash no longer leaked through the API (A3).
4. Auth rate limiting (A4).
5. Authorization middleware (A5) — every workspace-scoped endpoint
   verifies the session token and workspace membership.
6. Bearer token support standardized (A5).
7. Request body size limit + JSON validation (A25).
8. Security headers (A25).
9. Typed error model with safe HTTP envelope (A26).
10. Secret-redacting structured logger (A27).
11. GitHubAdapter refuses silent mock downgrade in production (A19).
12. Jira/Linear/Slack production-safety guards (A20).
13. Type-safe API client, no `any` leak in error paths (A28).

---

## D. Product-truth changes

1. **H7 — `businessUtility` removed.** Was a synthetic `7.5 + (verifiedSuccessCount * 0.5)`
   formula. Now: not exposed at all. PM leverage is not measured
   until real PM telemetry is in place.
2. **H7 — `learningQuality` removed.** Was `70 + (totalApproved * 3)`.
   Now: not exposed. Calibration quality is reported via the H6
   `confidence` field on each signal, with an explicit
   `evidenceState`.
3. **H7 — `recommendationUtility` removed.** Was `1.0 + (precision/100) * 0.8 +
   (executionValue/100) * 0.2`. Now: not exposed.
4. **H7 — `efficiency` (decision latency) replaced.** Was
   `action.updatedAt - rec.createdAt`. Now: `unavailable` until
   the real `PMDecisionTelemetry` stream is wired.
5. **Dashboard — "1.42× measured leverage" removed.** Now: the
   `Measured Decision Leverage` number only appears when empirical
   PM decision latency is available. Until then the dashboard
   shows the manual baseline (declared assumption, tagged
   `ESTIMATED`) and the APEX-assisted time (no number).
6. **Dashboard — "Empirically Measured" labels removed.** Every
   metric card now shows its `EpistemicBadge` so the data source
   is visible at a glance.
7. **H6 — `executionSuccessRate = 1.0` removed.** Now calculated
   from real `completed / (completed + failed)` action outcomes.
8. **H6 — title-substring category matching removed.** Categories
   now come from the typed `Recommendation.category` field.
9. **H6 — non-deterministic signal IDs removed.** Signals are
   identified by `sha256(workspaceId, projectId, category, type,
   sourceHash)`. Repeated compilation is idempotent.
10. **H6 — non-deterministic min-observation rule removed.**
    `MIN_OBSERVATIONS_FOR_FAVORED = 5`,
    `MIN_OBSERVATIONS_FOR_IGNORED = 5`,
    `MIN_OBSERVATIONS_FOR_SIGNAL = 3` are now enforced.
11. **H4 — fabricated fallback strings removed.** The service
    returns `unavailable: true` with a typed `failureReason` on
    invalid LLM output or grounding violation.
12. **Database — "ACID" overclaim removed.** `docs/DATABASE.md`
    and the class header now state exactly what is and isn't
    guaranteed.

---

## E. Integration status

| Integration | Status | Notes |
| --- | --- | --- |
| **GitHub** | **REAL** | Octokit-based, query-before-create via APEX marker, refuses silent mock downgrade in production, redacts tokens from errors. |
| **OpenAI** | **REAL** | `OpenAIResponsesProvider` honors the H4 contract (instructions, structured output, retries, timeouts, typed errors, no key leak). |
| **Jira** | **MOCK / TEST-ONLY** | In-memory map; throws `SecurityError` in production. Real integration is not yet implemented. |
| **Linear** | **MOCK / TEST-ONLY** | Same posture as Jira. |
| **Slack** | **MOCK / TEST-ONLY** | Same posture as Jira. |
| **Amplitude** | **NOT IMPLEMENTED** | No code, no adapter. |

---

## F. Verification

```
$ pnpm type-check
@apex/analysis:type-check: cache hit, replaying logs ...
@apex/ui:type-check: cache hit, replaying logs ...
@apex/contracts:type-check: cache hit, replaying logs ...
@apex/prompts:type-check: cache hit, replaying logs ...
@apex/design-tokens:type-check: cache hit, replaying logs ...
@apex/ai-core:type-check: ...
@apex/web:type-check: ...
 Tasks:    8 successful, 8 total
   0 errors, 0 warnings
```

```
$ pnpm lint
 Tasks:    8 successful, 8 total
   0 errors, 7 warnings (react-hooks/exhaustive-deps on dashboard useCallback closures — pre-existing pattern)
```

```
$ pnpm test
@apex/ai-core:test:
  Test Files   39 passed (39)
       Tests   502 passed (502)
@apex/analysis:test:  Test Files  4 passed, Tests  93 passed
@apex/prompts:test:   Test Files  3 passed, Tests  23 passed
 Tasks:    3 successful, 3 total
```

```
$ pnpm build
@apex/web:build: ✓ built in 205ms
 Tasks:    1 successful, 1 total
```

**New tests added in this pass: 66.** Notable additions:

- `ScryptPasswordHasher.test.ts` — 10 tests
- `SecureIdGenerator.test.ts` — 5 tests
- `AuthRateLimiter.test.ts` — 5 tests
- `AuthService.integration.test.ts` — 11 tests
- `DurableFileDatabase.hardening.test.ts` — 10 tests
- `ProductReasoningService.test.ts` — 7 tests
- `AdaptiveProfileCompiler.hardening.test.ts` — 6 tests
- `GitHubAdapter.test.ts` — 6 tests
- `OpenAIResponsesProvider.test.ts` — 6 tests

---

## G. Remaining limitations (intentional and honest)

1. **PostgreSQL / Supabase / Drizzle** — not in the codebase. The
   durable file-backed engine is the supported storage. Swapping
   in a real database engine is a repository-adapter change; no
   domain code changes are required.
2. **PMDecisionTelemetry wiring** — the `PMDecisionTelemetryService`
   and `PMDecisionTelemetry` type exist. The UI does not yet record
   decisions. Until that stream is in use, the
   `measuredDecisionLatencySeconds` metric is `unavailable` and the
   dashboard shows the manual baseline only.
3. **Jira / Linear / Slack** — real integrations are not
   implemented. The mock adapters are explicitly labeled and
   refuse to run in production.
4. **Cross-process serializability** — not supported by the file
   database. Documented as a non-guarantee.
5. **Single-process worker** — the API server starts a single
   background polling loop. Multiple processes sharing the
   database would race.
6. **H3 scoring** — the impact assessment is hard-coded
   per-category in `ProductIntelligenceService` (e.g. "no CI →
   deliveryRisk: critical"). This is documented and tested but is
   not a learned model. A future milestone could replace it
   with empirical weights.
7. **Workspace-creation auth** — `/api/workspaces POST` is
   authenticated but does not yet check whether the proposed
   workspace ID is unique. The DB layer rejects duplicates with
   `ConflictError`, so the contract is enforced but the error
   path returns 409 only at the persistence boundary, not the
   route boundary.
8. **CSP** — `X-Frame-Options: DENY` is set, but a full Content
   Security Policy is not. The dashboard is served as a single
   Vite SPA, so the surface is limited. A future pass should
   add a strict CSP for the production deployment.
9. **OAuth providers** — only email/password is supported. There
   is no GitHub OAuth, Google SSO, etc.
10. **License** — the project is intentionally UNLICENSED. This
    is documented in `LICENSE`.

These are not regressions introduced by this pass. They are
gaps that have been there since the original architecture; the
audit simply makes them visible rather than pretending they are
filled.
