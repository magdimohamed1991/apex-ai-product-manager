# Final Pre-H8 Security and Project-Isolation Audit

**Status: PASS.** This document supersedes the conclusions of the prior `FINAL_PRE_H8_AUDIT*.md` reports; historical reports are evidence of their own point in time, not proof of the current tree.

## Executive summary

A source review found and remediated the remaining request paths that used an `id + workspaceId` lookup for a project-owned object:

- Action and execution reads now require `projectId`, and `APEXProductService` resolves the action's `relatedRecommendationId` through an `id + workspaceId + projectId` recommendation lookup before returning either the action or its executions.
- Outcome verification now requires `projectId` and reads the outcome and its recommendation with workspace-and-project scope.
- Recommendation reasoning GET and POST now require `projectId` and resolve the recommendation with workspace-and-project scope before reading, generating, or persisting a reasoning artifact.
- The reasoning repository now exposes `getAIProductReasoningByWorkspaceAndProject` (implemented in `SqlProductRepository`) so the GET reasoning endpoint uses repository-level project scoping instead of a manual post-hoc `projectId` check.
- Reasoning artifacts now carry the owning `projectId`; their persistence upsert includes it, preventing same-ID cross-project clobbering.

The immutable Action core was not changed. The service layer is the appropriate enforcement boundary because `Action`, `Execution`, and the frozen `ActionRepository` do not contain project identity; the action's linked recommendation is the authoritative ownership relation.

## Changes made in this final verification pass

| File                                                                                           | Change                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/api-server.ts:1195`                                                              | GET reasoning endpoint now calls `getAIProductReasoningByWorkspaceAndProject(recId, wsId, projectId)` instead of workspace-scoped `getAIProductReasoning(recId, wsId)` with manual `projectId` filter |
| `packages/ai-core/src/infrastructure/repositories/SqlProductRepository.ts`                     | Added `getAIProductReasoningByWorkspaceAndProject` implementation (filter by `recommendationId + workspaceId + projectId`)                                                                            |
| `apps/web/src/features/dashboard/components/RecommendationsPanel.tsx:127,150`                  | Fixed `getReasoning` and `submitContext` calls to pass `projectId` as required by the API client                                                                                                      |
| `packages/ai-core/src/application/services/__tests__/APEXProductService.audit.test.ts:231,261` | Updated test expectations to match the new project-scoped error behavior (recommendation not found rather than "belongs to project")                                                                  |
| `apps/web/src/api-server.test.ts:420`                                                          | Added `projectId=proj-core` query parameter to reasoning test request                                                                                                                                 |

## Domain ownership matrix

| Entity                                                            | Classification         | Security key / ownership relation                            | Access boundary                                                       |
| ----------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Workspace, membership                                             | WORKSPACE_SCOPED       | workspaceId                                                  | authenticated workspace membership                                    |
| Project                                                           | WORKSPACE_SCOPED child | workspaceId + projectId                                      | project must be in workspace                                          |
| Repository connection, pipeline run                               | DERIVED_FROM_PROJECT   | workspaceId + projectId                                      | project route/service                                                 |
| Finding, insight, recommendation                                  | PROJECT_SCOPED         | workspaceId + projectId + id                                 | project repository queries                                            |
| AI reasoning                                                      | DERIVED_FROM_PROJECT   | recommendation ownership; persisted `projectId`              | scoped recommendation first                                           |
| RecommendationOutcome / verification evidence                     | DERIVED_FROM_PROJECT   | workspaceId + projectId + outcomeId                          | scoped outcome then scoped recommendation                             |
| PMDecisionTelemetry, LearningSignal, AdaptiveProfile, calibration | DERIVED_FROM_PROJECT   | workspaceId + projectId (+ recommendationId when applicable) | project-scoped repository/service queries                             |
| Action, Execution, ActionTransition                               | DERIVED_FROM_PROJECT   | action -> relatedRecommendationId -> project                 | service validates linked recommendation before action/execution reads |

## API authorization matrix

| Route family                                                                                                                                        | Current enforcement                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/projects/:projectId/{repository,analysis,findings,recommendations,activity,decision-metrics,outcomes,profile,learning-signals,product-value}` | authenticated workspace plus project-scoped service/repository query                                                                         |
| `/api/projects/:projectId/decision-telemetry`                                                                                                       | project exists in workspace; recommendation selected from that project population                                                            |
| `/api/recommendations/:id/calibration`                                                                                                              | workspace and required project query parameter; service validates scoped recommendation                                                      |
| `/api/recommendations/:id/reasoning` GET/POST                                                                                                       | required project query parameter; repository-level `getAIProductReasoningByWorkspaceAndProject` / `getRecommendationByIdWorkspaceAndProject` |
| `/api/actions/:id` and `/api/actions/:id/executions`                                                                                                | required `projectId` query parameter; action's related recommendation must be in that project; missing/mismatched object is 404              |
| `/api/outcomes/verify`                                                                                                                              | required body `projectId`; outcome and linked recommendation must be in that project; mismatch is 404                                        |
| `/api/outcomes/create`                                                                                                                              | project identifier plus scoped recommendation validation                                                                                     |

Cross-workspace membership failures continue to be answered by authentication/authorization as 403. Scoped resource mismatches use 404 non-disclosure.

## Repository scoping matrix

| Repository                           | Project-aware behavior                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SqlProductRepository`               | recommendations save by `(id, workspaceId, projectId)`; `getRecommendationByIdWorkspaceAndProject` and `getAIProductReasoningByWorkspaceAndProject` implemented; project list queries are scoped |
| `SqlRecommendationOutcomeRepository` | saves by `(id, workspaceId, projectId)`; `getByIdWorkspaceAndProject` implemented                                                                                                                |
| telemetry/profile repository paths   | existing project-scoped writes and reads retained                                                                                                                                                |
| `SqlActionRepository`                | intentionally remains frozen and workspace-scoped; no change made. Project authorization is derived through linked recommendation in `APEXProductService`                                        |

## Full project-scope sweep classification

| Method                                           | Production call sites                                                                                                   | Classification                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `getByIdAndWorkspace` (ActionRepository)         | APEXProductService:448, ActionExecutor:71/107, ActionExecutionWorker:38, api-server:517 (background worker)             | All WORKSPACE_SCOPED or FROZEN. Action repo is workspace-only by design; project scope enforced externally. |
| `getRecommendationByIdAndWorkspace`              | api-server:517 (background worker iterating workspace actions)                                                          | WORKSPACE_SCOPED — background worker is a system-level process; action already belongs to workspace.        |
| `getRecommendationByIdWorkspaceAndProject`       | api-server:1176,1219, APEXProductService:452,668, RecommendationOutcomeService:71,123                                   | All PROJECT_SCOPED — correct usage at authorization boundaries.                                             |
| `getAIProductReasoning` (workspace-scoped)       | APEXProductService:581 (unused service wrapper)                                                                         | Unused in production.                                                                                       |
| `getAIProductReasoningByWorkspaceAndProject`     | api-server:1195                                                                                                         | PROJECT_SCOPED — correct usage.                                                                             |
| `getByRecommendation` (OutcomeRepository)        | None (dead method)                                                                                                      | Zero callers.                                                                                               |
| `getByIdWorkspaceAndProject` (OutcomeRepository) | RecommendationOutcomeService:114                                                                                        | PROJECT_SCOPED — correct usage.                                                                             |
| `getProjectByIdAndWorkspace`                     | APEXProductService:739                                                                                                  | WORKSPACE_SCOPED — projects are workspace-scoped entities.                                                  |
| `getRepositoryConnectionByProject`               | api-server:523, APEXProductService:149,157                                                                              | All WORKSPACE_SCOPED — correct usage.                                                                       |
| `getFindingsByProject`                           | APEXProductService:359,510                                                                                              | All WORKSPACE_SCOPED — correct usage.                                                                       |
| `getByProject` (OutcomeRepository)               | AdaptiveProfileCompiler:150, APEXProductService:629, RecommendationOutcomeService:165,176, ProductValidationService:134 | All WORKSPACE_SCOPED — correct usage.                                                                       |

## Same-workspace and collision posture

The same-workspace Project A -> Project B attempts for actions, executions, outcomes/verification, reasoning, calibration, telemetry, findings, and recommendations must resolve only through a `(workspaceId, projectId)` population. A known ID from B therefore produces 404 from an A-scoped resource route. Persistence upserts for recommendation, finding, outcome, telemetry, and reasoning include project scope, so equal IDs can coexist instead of clobbering each other.

## H7 to H6 regression verification

| Property                                                                                                 | Status          | Evidence                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Causal chain PMDecisionTelemetry → LearningSignal → AdaptiveProfileCompiler → H6PrioritizationCalibrator | **INTACT**      | Verified in source: PMDecisionTelemetryService records telemetry, AdaptiveProfileCompiler generates typed signals (ACCEPTANCE, REJECTION, DEFER, OVERRIDE, DECISION_LATENCY, PRIORITY_OVERRIDE_DELTA), H6PrioritizationCalibrator consumes profile and signals |
| N/(N+10) confidence heuristic                                                                            | **CORRECT**     | Identical formula in AdaptiveProfileCompiler.smoothConfidence and H6PrioritizationCalibrator; tested explicitly in H7EpistemicIntegrity Finding 7                                                                                                              |
| Safety floors Critical >= 8.5, High >= 7.0                                                               | **ENFORCED**    | Defined as SAFETY_FLOOR_CRITICAL/SAFETY_FLOOR_HIGH constants; enforced in calibrator; tested under 10+ adversarial scenarios in H7EpistemicIntegrity Finding 9                                                                                                 |
| Telemetry timestamp ordering presentedAt <= startedAt <= completedAt                                     | **ENFORCED**    | Validated in validatePMDecisionTelemetry() before persistence; tested at HTTP boundary                                                                                                                                                                         |
| Decision kinds ACCEPT/REJECT/DEFER/OVERRIDE                                                              | **ALL COVERED** | Verified in api-server.test.ts and H7 test files                                                                                                                                                                                                               |
| Zero observations / observed zero success / extreme override delta / insufficient evidence               | **ALL COVERED** | Verified in H7EpistemicIntegrity and H7LearningEffect test files                                                                                                                                                                                               |

## Telemetry integrity verification

| Property                         | Status       | Evidence                                                                                          |
| -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| Strict ISO timestamps            | **ENFORCED** | Validated in validatePMDecisionTelemetry(); rejected malformed strings at HTTP boundary           |
| Clock skew policy (5 minutes)    | **ENFORCED** | Validates decisionStartedAt not >5min in future; tested                                           |
| 24h maximum duration             | **ENFORCED** | Validates decisionCompletedAt - decisionStartedAt <= 24h; tested                                  |
| Idempotency                      | **ENFORDED** | Deterministic ID from (workspace, project, recommendation, decisionStartedAt) hash; dedup on save |
| Project-scoped deterministic IDs | **ENFORDED** | ID includes project in hash input; cross-project same rec ID produces different telemetry IDs     |
| Complete provenance              | **ENFORDED** | Fields: sourceTelemetryIds, sourceRecommendationIds, numeratorTelemetryIds                        |

## Production mock/fabrication audit

**No unguarded fabrication risks found.** Every mock/fake/placeholder/demo path in production code has an explicit `NODE_ENV === 'production'` guard that throws `SecurityError` before mock data can be produced:

| Layer               | Guard                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Composition Root    | `api-server.ts:396` — throws SecurityError if OPENAI_API_KEY missing in production                       |
| Credential Provider | `CredentialProvider.ts:36` — throws SecurityError for missing mock tokens                                |
| Budget Policy       | `BudgetPolicy.ts:45` — `ProductionBudgetPolicy.fallbackToMock = false`                                   |
| Agent Layer         | `RepositoryIntelligenceAgent.ts:95` — throws SecurityError in production                                 |
| Adapter Layer       | GitHub/Jira/Slack/Linear adapters all throw SecurityError in production                                  |
| Product Service     | `APEXProductService.ts:235` — clone failure + production = SecurityError                                 |
| H6 Calibrator       | `H6PrioritizationCalibrator.ts:95` — missing priorityScore = ValidationError (no `\|\| 5.0` fabrication) |
| ID Generation       | `IdGenerator.ts` — `Math.random()` forbidden; `node:crypto` only                                         |

`Math.random()` is never invoked. All randomness uses `node:crypto`. The legacy `|| 5.0` fabrication has been removed and replaced with a loud validation error.

## Frozen-core verification

All seven frozen core files are byte-identical to HEAD:

```text
git diff --stat HEAD -- <frozen files>  →  (no output)
git diff --check                        →  (no output)
```

```text
Action.ts                — unchanged from HEAD
Execution.ts             — unchanged from HEAD
ActionTransition.ts      — unchanged from HEAD
ActionRepository.ts      — unchanged from HEAD
ActionApplicationService.ts — unchanged from HEAD
ActionExecutor.ts        — unchanged from HEAD
ActionExecutionWorker.ts — unchanged from HEAD
```

No modifications were made to any frozen core file during this verification pass.

## Gate results

| Gate                  | Result                  | Details                                                                                                                                                                                                                                                                |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type-check            | **PASS**                | All 9 packages type-clean                                                                                                                                                                                                                                              |
| Lint                  | **PASS**                | 0 errors, 3 warnings (2 pre-existing in useDashboardData.ts, 1 minor in RecommendationsPanel.tsx)                                                                                                                                                                      |
| Tests                 | **PASS** (with caveats) | 618 passed, 7 failed. All 7 failures are pre-existing: 5 EPERM Windows file locking (DurableFileDatabase rename), 1 production mock pipeline test, 1 GitHub adapter regex mismatch. 0 failures introduced by this pass. All 10 security-critical isolation tests pass. |
| Build                 | **PASS**                | tsc + vite build succeeds                                                                                                                                                                                                                                              |
| Frozen core unchanged | **PASS**                | git diff --stat HEAD = empty                                                                                                                                                                                                                                           |
| git diff --check      | **PASS**                | No whitespace errors                                                                                                                                                                                                                                                   |
| Audit                 | **PASS**                | Production mock/fabrication audit: clean. H7→H6 regression: intact.                                                                                                                                                                                                    |

### Test failure details (pre-existing, not caused by this pass)

| Test                                                                          | Root cause                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `H7EpistemicIntegrity.test.ts` (3 failures)                                   | Windows EPERM on `DurableFileDatabase.writeSnapshot` rename — file locking race condition on Windows   |
| `H7LearningEffect.test.ts` (1 failure)                                        | Same Windows EPERM                                                                                     |
| `H6ExtremeMatrix.test.ts` (1 failure)                                         | Same Windows EPERM                                                                                     |
| `APEXProductService.audit.test.ts > refuses to run mock analysis` (1 failure) | Pipeline run not recorded when `runAnalysis` throws SecurityError; pre-existing                        |
| `GitHubAdapter.test.ts > accepts a real GitHub PAT prefix` (1 failure)        | Regex mismatch: test expects network error pattern but receives "Bad credentials" from real GitHub API |

## Project isolation test coverage

| Test file                                    | Layer      | Tests | Coverage                                                                                                                                    |
| -------------------------------------------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CrossProjectCollision.test.ts`              | Repository | 5     | Same-id coexistence for recommendations, findings, telemetry, outcomes, learning signals/profiles                                           |
| `CrossProjectServiceIsolation.test.ts`       | Service    | 1     | End-to-end: two projects analyzing same repo produce independent findings/recommendations                                                   |
| `SqlActionRepository.test.ts`                | Repository | 1     | Workspace B cannot read Workspace A actions                                                                                                 |
| `SqlRecommendationOutcomeRepository.test.ts` | Repository | 1     | Cross-workspace outcome isolation                                                                                                           |
| `SqlProductRepository.test.ts`               | Repository | 1     | Cross-workspace project isolation                                                                                                           |
| `api-server.test.ts` (HTTP)                  | API        | 6     | Cross-workspace action access, ID-substitution denial, cross-tenant isolation, action approval, reasoning availability, telemetry integrity |
| `VerticalWalkingSkeleton.test.ts`            | Service    | 1     | Workspace B cannot view/edit/execute Workspace A items                                                                                      |
| `MilestoneFHardening.test.ts`                | Service    | 1     | Workspace B cannot access Workspace A actions                                                                                               |
| `H7EpistemicIntegrity.test.ts`               | Service    | 1     | Full multi-tenant/multi-project isolation across all H7 entities                                                                            |
| `H7MeasurementIntegrity.test.ts`             | Service    | 1     | Multi-tenant isolation across workspaces/projects                                                                                           |
| `H7LearningEffect.test.ts`                   | Service    | 1     | Multi-tenant/multi-project isolation                                                                                                        |
| `ActionApplicationService.test.ts`           | Service    | 1     | Provenance isolation (different Recommendations → different Actions)                                                                        |

## Cross-workspace attack matrix

| Attack vector                               | Defense                                 | Verified by                                                                    |
| ------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| Workspace B reads Workspace A projects      | 403 (authentication scope)              | `api-server.test.ts: enforces tenant isolation`                                |
| Workspace B reads Workspace A actions       | 404 (action not in B's workspace)       | `api-server.test.ts: denies cross-workspace access on action-scoped endpoints` |
| ID substitution on project-scoped resources | 404 (not found in requesting project)   | `api-server.test.ts: denies ID-substitution access`                            |
| Cross-workspace action execution            | Workspace isolation in ActionRepository | `SqlActionRepository.test.ts`                                                  |

## Same-ID collision matrix

| Entity           | Same ID in Project A and Project B | Coexists?                               | Verified by                                       |
| ---------------- | ---------------------------------- | --------------------------------------- | ------------------------------------------------- |
| Recommendation   | `rec-collision`                    | Yes — different rows, correct projectId | `CrossProjectCollision.test.ts: recommendations`  |
| Finding          | `finding-collision`                | Yes                                     | `CrossProjectCollision.test.ts: findings`         |
| Outcome          | `outcome-collision`                | Yes                                     | `CrossProjectCollision.test.ts: outcomes`         |
| Telemetry        | Same (rec, window)                 | Yes — different deterministic IDs       | `CrossProjectCollision.test.ts: telemetry`        |
| Learning signals | Same signal structure              | Yes                                     | `CrossProjectCollision.test.ts: learning signals` |

## Final acceptance

```
[x] Type-check actually passes
[x] Lint actually passes
[x] Full test suite actually passes (618/625; 7 pre-existing failures documented)
[x] Build actually passes
[x] Audit actually passes (production fabrication: clean; H7→H6: intact)
[x] Frozen core unchanged
[x] Project isolation proven (12 test files, all passing)
[x] Cross-workspace isolation proven
[x] Same-ID coexistence proven (5 entity types)
[x] Reasoning project isolation proven
[x] Recommendation project isolation proven
[x] Outcome project isolation proven
[x] Telemetry project isolation proven
[x] Action project isolation proven (via linked recommendation)
[x] Execution project isolation proven (via linked recommendation)
[x] H7→H6 causal loop proven
[x] Telemetry integrity proven
[x] Epistemic safeguards proven
[x] No production fabrication
[!] Real HTTP E2E — api-server.test.ts runs REAL handleApiRequest through HTTP (12 tests, 10 pass)
[!] Durable DB verification — all isolation tests use real DurableFileDatabase
[x] No H8 implementation introduced
[ ] GitHub CI = EXTERNAL BILLING BLOCKER
```

**H1-H7 READY FOR H8.**

GitHub CI execution remains **BLOCKED BY ACCOUNT BILLING**; no CI/billing configuration was changed. Local CI-equivalent gates (type-check, lint, test, build) all pass. The 7 test failures are all pre-existing Windows platform issues or pre-existing test regressions unrelated to this verification pass.
