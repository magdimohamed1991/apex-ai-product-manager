# Engineering Remediation Audit Report

**Date:** August 13, 2026
**Scope:** Full repository audit — H1–H12 complete, V2.1 Continuous Intelligence on disk
**Method:** Source-level inspection of every package, service, repository, component, and test

---

## Gate Results

| Gate                    | Result                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `pnpm turbo type-check` | ✅ 8/8 successful                                                   |
| `pnpm turbo lint`       | ✅ 8/8 successful (0 errors, 3 pre-existing warnings)               |
| `pnpm turbo test`       | ✅ 4/4 successful (674 ai-core tests, 33 web tests = **707 total**) |
| `pnpm turbo build`      | ✅ Successful                                                       |
| `pnpm audit`            | ✅ No vulnerabilities                                               |

---

## PHASE 1 — Repository Audit

**205 TypeScript files** across `packages/ai-core` and **33** in `apps/web`.

### Architecture Compliance

- ✅ Strict DDD/Clean Architecture maintained throughout H9–H12 + V2.1
- ✅ Domain entities → repository interfaces → application services → SQL repositories → API routes → frontend
- ✅ No circular dependencies detected
- ✅ Frozen core files (Action.ts, Execution.ts, ActionTransition.ts, ActionRepository.ts, ActionApplicationService.ts, ActionExecutor.ts, ActionExecutionWorker.ts) **untouched** — verified via `git diff --stat`

### Coverage by Domain

| Domain         | Entity | Repository | Service | SQL Repo | API Routes | Frontend | Tests |
| -------------- | ------ | ---------- | ------- | -------- | ---------- | -------- | ----- |
| H9 Competitor  | ✅     | ✅         | ✅      | ✅       | ✅         | ✅       | ✅    |
| H10 UX         | ✅     | ✅         | ✅      | ✅       | ✅         | ✅       | ✅    |
| H11 Browser    | ✅     | ✅         | ✅      | ✅       | ✅         | ✅       | ✅    |
| H12 Executive  | ✅     | ✅         | ✅      | ✅       | ✅         | ✅       | ✅    |
| V2.1 Scheduled | ✅     | ✅         | ✅      | ✅       | ✅         | ✅       | ✅    |

---

## PHASE 2 — Security Audit

### Findings

| Category            | Status   | Detail                                                                                                                                                                     |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL injection       | ✅ Clean | No raw SQL — DurableFileDatabase uses in-memory arrays with typed filters                                                                                                  |
| Path traversal      | ✅ Clean | `execFileSync` in APEXProductService guarded by `SAFE_GITHUB_NAME` regex (`/^[a-zA-Z0-9._-]+$/`) on owner/repo before interpolation                                        |
| Command injection   | ✅ Clean | `execFileSync` (not `execSync`) — no shell interpretation. Input validated                                                                                                 |
| Shell interpolation | ✅ Clean | No template literals with user input passed to shell commands                                                                                                              |
| eval()/Function()   | ✅ Clean | Zero occurrences in production code                                                                                                                                        |
| XSS                 | ✅ Clean | MarkdownPreview uses `react-markdown` without `rehype-raw` — raw HTML becomes inert text. Default `urlTransform` blocks `javascript:` URLs. Zero `dangerouslySetInnerHTML` |
| CSRF                | ✅ Clean | All state-changing routes require Bearer token authentication                                                                                                              |
| SSRF                | ✅ Clean | Browser Intelligence Service is a simulated crawler — no actual HTTP requests. `robotsPolicy` is a recorded metadata structure                                             |
| Open redirect       | ✅ Clean | No redirect logic in frontend or API                                                                                                                                       |
| Prototype pollution | ✅ Clean | Zero `__proto__`, `constructor[]`, or unsafe `Object.assign` patterns                                                                                                      |
| Credential leakage  | ✅ Clean | No tokens/passwords/secrets in log statements. `execFileSync` auth URL error is caught before logging                                                                      |
| Hardcoded secrets   | ✅ Clean | All credentials via environment variables through `EnvCredentialProvider`                                                                                                  |
| Race conditions     | ✅ Clean | DurableFileDatabase uses atomic file-swap commits with write mutex. Action claiming uses optimistic locking                                                                |

### Noted (pre-existing, not introduced by this work)

| Item                                 | Risk | Rationale                                                                                                             |
| ------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `execFileSync` in APEXProductService | Low  | Input validated with strict regex. `execFileSync` avoids shell. Used only for `git clone --depth 1` in temp directory |

---

## PHASE 3 — Multi-Tenancy Audit

### Repository Method Classification

Every repository method verified for correct scoping:

| Repository                           | Methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Scoping                             | Status |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------ |
| SqlActionRepository                  | getByIdAndWorkspace, getByWorkspace, save, deleteAndWorkspace, claimForExecution, saveExecution, getExecutionsByAction, saveTransition, getTransitionsByAction, persistExecutionOutcome, getPendingActionsAndWorkspace                                                                                                                                                                                                                                                                                                                                                                        | All workspace-scoped                | ✅     |
| SqlProductRepository                 | getProjectByIdAndWorkspace, getProjectsByWorkspace, saveProject, getRepositoryConnectionByIdAndWorkspace, getRepositoryConnectionByProject, getPipelineRunByIdAndWorkspace, getPipelineRunsByProject, getFindingsByProject, saveFinding, deleteFindingsByProject, getRecommendationsByProject, getRecommendationByIdAndWorkspace, getRecommendationByIdWorkspaceAndProject, saveRecommendation, deleteRecommendationsByProject, findProjectIdsForRecommendation, getAIProductReasoningByWorkspaceAndProject, savePMDecisionTelemetry, getPMDecisionTelemetryByProject, saveAIProductReasoning | All workspace+project scoped        | ✅     |
| SqlCompetitorRepository              | All 10 methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | (id, workspaceId, projectId) scoped | ✅     |
| SqlUXRepository                      | All 12 methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | (id, workspaceId, projectId) scoped | ✅     |
| SqlBrowserIntelligenceRepository     | All 8 methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | (id, workspaceId, projectId) scoped | ✅     |
| SqlExecutiveRepository               | All 9 methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | (id, workspaceId, projectId) scoped | ✅     |
| SqlScheduledJobRepository            | All 12 methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | (id, workspaceId, projectId) scoped | ✅     |
| SqlRecommendationOutcomeRepository   | All 5 methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | (id, workspaceId, projectId) scoped | ✅     |
| SqlAdaptiveLearningProfileRepository | All 4 methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | (workspaceId, projectId) scoped     | ✅     |

### Service-Level Ownership Verification

All application services verify project ownership via `ProductRepository.getProjectByIdAndWorkspace` before operating:

- ✅ CompetitorIntelligenceService
- ✅ UXIntelligenceService
- ✅ BrowserIntelligenceService
- ✅ ExecutiveIntelligenceService
- ✅ ScheduledIntelligenceService

---

## PHASE 4 — Data Integrity Audit

| Check               | Status | Detail                                                                                                                    |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Idempotency         | ✅     | All upserts filter by (id, workspaceId, projectId) before insert                                                          |
| Uniqueness          | ✅     | Action idempotency key uniqueness enforced. Session id uniqueness enforced. User email uniqueness enforced                |
| Foreign keys        | ✅     | Execution→Action, Transition→Action, Finding→Project, Recommendation→Project all verified                                 |
| Orphan detection    | ✅     | Cascading deletes in SqlScheduledJobRepository (job deletion cleans executions + metrics)                                 |
| Duplicate detection | ✅     | Telemetry upsert by deterministic hash of (workspace, project, recommendation, decisionStartedAt)                         |
| Project collisions  | ✅     | Upserts always scoped by (id, workspaceId, projectId)                                                                     |
| Hash collisions     | ✅     | Content hash for crawl dedup uses SHA-256(url + pageType). UUIDs for entity IDs                                           |
| Fabricated metrics  | ✅     | Executive Intelligence: KPIs with zero observations yield `null` scores and `status: 'unknown'`. No fabricated confidence |
| Invented scores     | ✅     | Competitor positioning: your score labeled `baseline_assumption`. No fake data                                            |

---

## PHASE 5 — Performance Audit

| Check                   | Status            | Detail                                                                                                                                                       |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N+1 queries             | ✅ Acceptable     | Sequential saves in CompetitorIntelligenceService and APEXProductService are within single-process transactions — acceptable for single-process architecture |
| Deep cloning            | 22 calls in infra | Standard pattern for isolation. Each clone is domain-sized (not unbounded). Acceptable                                                                       |
| Duplicate serialization | ✅ Clean          | No redundant JSON.parse/JSON.stringify chains                                                                                                                |
| Synchronous filesystem  | ✅ Acceptable     | DurableFileDatabase uses atomic file-swap. Synchronous writes are by design for durability guarantee                                                         |
| Cache opportunities     | Noted             | Markdown preview bundle could benefit from lazy loading (499KB → ~343KB without react-markdown). Low priority — not a runtime performance issue              |

---

## PHASE 6 — Frontend Audit

| Check               | Status   | Detail                                                                             |
| ------------------- | -------- | ---------------------------------------------------------------------------------- |
| useEffect cleanup   | ✅       | All 4 useEffects use `let active = true` pattern with cleanup                      |
| setInterval cleanup | ✅       | `useDashboardData` polling: `clearInterval(id)` in cleanup                         |
| Stale closures      | ✅       | `requestSeqRef` discards stale responses. `aliveRef` prevents post-unmount updates |
| Dependency arrays   | ✅       | All useCallback/useEffect deps are stable (workspace, project, handleError)        |
| ARIA/labels         | ⚠️ Minor | Some buttons lack explicit `aria-label` — not blocking but not ideal               |
| Empty states        | ✅       | All panels have empty state messages                                               |
| Error states        | ✅       | API errors surfaced through `setGlobalError` and panel-level catches               |
| Loading states      | ✅       | `loadingWorkspaces`, `loadingStats` states present                                 |
| Keyboard traps      | ✅ Clean | No focus traps or inaccessible modals                                              |

---

## PHASE 7 — Browser Intelligence Audit

| Check               | Status | Detail                                                                                         |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Crawl deduplication | ✅     | Content hash = SHA-256(url + pageType). Previous crawl checked via `getLatestCrawledPageByUrl` |
| Hash stability      | ✅     | Hash excludes jobId — identical re-crawls produce same hash → no `changedAt`                   |
| Rate limiting       | ✅     | 1-second minimum between requests per domain. `RATE_LIMIT_MIN_INTERVAL_MS = 1000`              |
| Robots.txt          | ✅     | Recorded as metadata structure (requires browser runtime for real parsing — documented)        |
| Session cleanup     | ✅     | Session upsert by (id, workspaceId, projectId)                                                 |
| Domain isolation    | ✅     | Rate limit states tracked per domain within job                                                |
| Crawl limits        | ✅     | Normalized targets with conservative defaults. `followLinks: false`, `maxDepth: 0`             |

---

## PHASE 8 — Executive Intelligence Audit

| Check                 | Status | Detail                                                                       |
| --------------------- | ------ | ---------------------------------------------------------------------------- |
| Trend detection       | ✅     | Compares current snapshot against previous — honest about insufficient data  |
| Snapshot comparison   | ✅     | Weighted overall score from KPIs with observations only                      |
| Report generation     | ✅     | 8-section reports with markdown/JSON export                                  |
| Epistemic annotations | ✅     | KPIs include `evidenceSources`, `confidence`, `observationCount`             |
| Unknown handling      | ✅     | Zero-observation KPIs → `null` score → `status: 'unknown'`. Never fabricated |
| Cross-project data    | ✅     | Repository scoping prevents any cross-project leakage                        |

---

## PHASE 9 — Learning Loop Audit

| Check                      | Status   | Detail                                                                                 |
| -------------------------- | -------- | -------------------------------------------------------------------------------------- |
| PMDecisionTelemetry        | ✅       | Scoped by (id, workspaceId, projectId). Deterministic hash for idempotency             |
| LearningSignal             | ✅       | Scoped by (workspaceId, projectId). Upsert by (workspaceId, projectId, category, type) |
| AdaptiveProfileCompiler    | ✅       | Reads only project-scoped signals                                                      |
| H6PrioritizationCalibrator | ✅       | Produces calibration signals with `source` field for provenance                        |
| Fabricated evidence        | ✅ Clean | No hardcoded metrics, no Math.random in scoring, no synthetic data                     |

---

## PHASE 10 — Test Audit

**674 ai-core tests + 33 web tests = 707 total**

### Test Coverage by Domain

| Domain          | Test File                             | Tests | Key Coverage                                                                                                                        |
| --------------- | ------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| H9 Competitor   | CompetitorIntelligenceService.test.ts | 8     | add competitor, run analysis, feature matrix, positioning, differentiation, gaps, recommendations                                   |
| H10 UX          | UXIntelligenceService.test.ts         | 8     | add journey, add friction, run analysis, critical recommendations, optimize_flow                                                    |
| H11 Browser     | BrowserIntelligenceService.test.ts    | 8     | start crawl, content hash, rate limiting, robots, sessions                                                                          |
| H12 Executive   | ExecutiveIntelligenceService.test.ts  | 7     | generate dashboard, health snapshot, trends, report generation, export                                                              |
| V2.1 Scheduled  | ScheduledIntelligenceService.test.ts  | 13    | CRUD, pause/resume, trigger, completion, metrics, auto-pause, retry backoff, cron/interval scheduling, deletion, jobs-due detection |
| API Integration | api-server.h9-h12.test.ts             | 7     | Full lifecycle, 401 auth, 403 tenant isolation, 429 rate limiting                                                                   |
| GitHub Adapter  | GitHubAdapter.test.ts                 | 4     | Deterministic (fetch-stubbed), no network dependency                                                                                |

---

## PHASE 11 — Documentation Audit

| Document                    | Status                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ |
| H9–H12 Stabilization Report | ✅ Written (`packages/ai-core/docs/H9-H12-STABILIZATION-REPORT.md`)                  |
| RC Declaration              | ✅ Included in stabilization report                                                  |
| Architecture                | ✅ DDD/Clean Architecture pattern documented in service-level JSDoc                  |
| Security                    | ✅ `execFileSync` input validation documented. SSRF "requires browser runtime" noted |

---

## PHASE 12 — Final Verification

| Check              | Status                                        |
| ------------------ | --------------------------------------------- |
| type-check         | ✅ 8/8                                        |
| lint               | ✅ 8/8 (0 errors)                             |
| test               | ✅ 4/4 (707 tests pass)                       |
| build              | ✅ Successful                                 |
| audit              | ✅ No vulnerabilities                         |
| Frozen core hashes | ✅ Untouched (verified via `git diff --stat`) |

---

## Findings Summary

### Security Findings

| #   | Severity | Finding                                                                                           | Status                                                                 |
| --- | -------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| S1  | Low      | `execFileSync` in APEXProductService uses user-influenced `owner`/`repository` in git clone URL   | **Mitigated** — input validated with strict regex before interpolation |
| S2  | Info     | Browser Intelligence `robotsPolicy` is a recorded metadata structure, not real robots.txt parsing | **Documented** — requires browser runtime for real parsing             |

### Performance Findings

| #   | Severity | Finding                                                         | Status                                                             |
| --- | -------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| P1  | Info     | 22 deepClone calls across SQL repositories                      | **Acceptable** — domain-sized objects, single-process architecture |
| P2  | Low      | Markdown preview adds ~156KB to web bundle (343KB → 499KB gzip) | **Noted** — lazy loading would reduce initial bundle. Not blocking |

### Architecture Findings

| #   | Severity | Finding                                                                         | Status                                                                                |
| --- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A1  | Info     | Sequential entity saves in CompetitorIntelligenceService (5 saves per analysis) | **Acceptable** — within single-process transaction, not a bottleneck at current scale |
| A2  | Info     | DeepClone function duplicated across 4 SQL repositories                         | **Noted** — could be extracted to shared utility. Low priority                        |

### Test Coverage Additions

| #   | Severity | Finding                                        | Status                                                                                 |
| --- | -------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| T1  | Info     | No integration tests for V2.1 Scheduled routes | **Noted** — service-level tests provide good coverage. Route tests can be added in H13 |

---

## Risk Assessment

| Risk                       | Likelihood | Impact | Mitigation                                                     |
| -------------------------- | ---------- | ------ | -------------------------------------------------------------- |
| SSRF via browser crawl     | None       | N/A    | Service is simulated — no actual HTTP requests                 |
| Credential leakage in logs | None       | N/A    | Verified: no tokens/secrets in any log statements              |
| Cross-tenant data leakage  | None       | N/A    | Every repository method verified for workspace+project scoping |
| Fabricated metrics         | None       | N/A    | Honest epistemic annotations throughout. Unknown stays unknown |
| Frozen core regression     | None       | N/A    | All 7 frozen core files verified untouched                     |

---

## Production Readiness Score: **9.2 / 10**

**Justification:**

- All 12 audit phases completed with zero critical findings
- All quality gates green (type-check, lint, test, build, audit)
- Frozen core integrity verified
- Multi-tenancy isolation verified across all 9 SQL repositories
- Security surface minimal (no eval, no shell injection, no XSS, no SSRF, no credential leakage)
- 707 tests passing across 61 test files
- Epistemic integrity maintained — no fabricated metrics, no fake confidence

**Deductions:**

- -0.3: Frontend ARIA coverage could be improved (minor accessibility gaps)
- -0.3: Bundle size increased with react-markdown (not lazy-loaded yet)
- -0.2: No integration tests for V2.1 Scheduled Intelligence API routes

**None of these are blocking issues.** The repository is production-ready.
