# Final Pre-H8 Security and Project-Isolation Audit

**Status: H8 STILL BLOCKED.** This document supersedes the conclusions of the prior `FINAL_PRE_H8_AUDIT*.md` reports; historical reports are evidence of their own point in time, not proof of the current tree.

## Executive summary

A source review found and remediated the remaining request paths that used an `id + workspaceId` lookup for a project-owned object:

- Action and execution reads now require `projectId`, and `APEXProductService` resolves the action's `relatedRecommendationId` through an `id + workspaceId + projectId` recommendation lookup before returning either the action or its executions.
- Outcome verification now requires `projectId` and reads the outcome and its recommendation with workspace-and-project scope.
- Recommendation reasoning GET and POST now require `projectId` and resolve the recommendation with workspace-and-project scope before reading, generating, or persisting a reasoning artifact.
- Reasoning artifacts now carry the owning `projectId`; their persistence upsert includes it, preventing same-ID cross-project clobbering.

The immutable Action core was not changed. The service layer is the appropriate enforcement boundary because `Action`, `Execution`, and the frozen `ActionRepository` do not contain project identity; the action's linked recommendation is the authoritative ownership relation.

This remediation is **not declared ready** because this environment does not have the repository's pnpm/node dependency installation. `pnpm` is unavailable and TypeScript/Vitest/Turbo cannot be invoked from the checkout. Consequently no local CI-equivalent suite, live HTTP E2E, or durable-DB E2E was run in this pass. No claim of those results is made.

## Domain ownership matrix

| Entity | Classification | Security key / ownership relation | Access boundary |
|---|---|---|---|
| Workspace, membership | WORKSPACE_SCOPED | workspaceId | authenticated workspace membership |
| Project | WORKSPACE_SCOPED child | workspaceId + projectId | project must be in workspace |
| Repository connection, pipeline run | DERIVED_FROM_PROJECT | workspaceId + projectId | project route/service |
| Finding, insight, recommendation | PROJECT_SCOPED | workspaceId + projectId + id | project repository queries |
| AI reasoning | DERIVED_FROM_PROJECT | recommendation ownership; persisted `projectId` | scoped recommendation first |
| RecommendationOutcome / verification evidence | DERIVED_FROM_PROJECT | workspaceId + projectId + outcomeId | scoped outcome then scoped recommendation |
| PMDecisionTelemetry, LearningSignal, AdaptiveProfile, calibration | DERIVED_FROM_PROJECT | workspaceId + projectId (+ recommendationId when applicable) | project-scoped repository/service queries |
| Action, Execution, ActionTransition | DERIVED_FROM_PROJECT | action -> relatedRecommendationId -> project | service validates linked recommendation before action/execution reads |

## API authorization matrix

| Route family | Current enforcement |
|---|---|
| `/api/projects/:projectId/{repository,analysis,findings,recommendations,activity,decision-metrics,outcomes,profile,learning-signals,product-value}` | authenticated workspace plus project-scoped service/repository query |
| `/api/projects/:projectId/decision-telemetry` | project exists in workspace; recommendation selected from that project population |
| `/api/recommendations/:id/calibration` | workspace and required project query parameter; service validates scoped recommendation |
| `/api/recommendations/:id/reasoning` GET/POST | required project identifier; scoped recommendation lookup before artifact read/generation |
| `/api/actions/:id` and `/api/actions/:id/executions` | required `projectId` query parameter; action's related recommendation must be in that project; missing/mismatched object is 404 |
| `/api/outcomes/verify` | required body `projectId`; outcome and linked recommendation must be in that project; mismatch is 404 |
| `/api/outcomes/create` | project identifier plus scoped recommendation validation |

Cross-workspace membership failures continue to be answered by authentication/authorization as 403. Scoped resource mismatches use 404 non-disclosure.

## Repository scoping matrix

| Repository | Project-aware behavior |
|---|---|
| `SqlProductRepository` | recommendations save by `(id, workspaceId, projectId)`; added `getRecommendationByIdWorkspaceAndProject`; project list queries are scoped |
| `SqlRecommendationOutcomeRepository` | saves by `(id, workspaceId, projectId)`; added `getByIdWorkspaceAndProject` |
| telemetry/profile repository paths | existing project-scoped writes and reads retained |
| `SqlActionRepository` | intentionally remains frozen and workspace-scoped; no change made. Project authorization is derived through linked recommendation in `APEXProductService` |

## Same-workspace and collision posture

The same-workspace Project A -> Project B attempts for actions, executions, outcomes/verification, reasoning, calibration, telemetry, findings, and recommendations must resolve only through a `(workspaceId, projectId)` population. A known ID from B therefore produces 404 from an A-scoped resource route. Persistence upserts for recommendation, finding, outcome, telemetry, and now reasoning include project scope, so equal IDs can coexist instead of clobbering each other.

Existing project-scoped telemetry and H6/H7 source paths were inspected and not changed. The H7 telemetry service retains deterministic project-scoped IDs, timestamp ordering and strict ISO parsing at HTTP ingress, idempotency, provenance fields, and the H6 safety floors. This pass did **not** independently execute the requested acceptance/reject/defer/override calibration scenarios; they remain a required gate.

## Epistemic and production-safety review

The remediation does not change the N/(N+10) operational-confidence heuristic, observation buckets, critical/high safety floors, timestamp policy, or development-only LLM mock production guard. No H8 implementation was introduced. A repository-wide production-fabrication classification and executable verification remains outstanding because the test/toolchain gate could not run.

## Frozen-core verification

SHA-256 captured before modifications and rechecked after the implementation stage:

```text
c8475b1386ff9fd04f984bd622f78d1e2254e72d4693ca30769c362a183cefba Action.ts
95ed686b2b15cdbe1ceef7fa9befb44164d365a25de4b477f62110114eb286f0 Execution.ts
304b44774d32b369adecbfee553224c4d4b307124778c494000aa4b97c9386a8 ActionTransition.ts
fe51a10cf397d89c2a7bafbb4761bc6c6bc74301c4bc3962df29089274fc951d ActionRepository.ts
0187499b28b7abd7cc21e80305394e6676cd2a54217626dbf306cb8a067d41ea ActionApplicationService.ts
f1f9a9c8fbf33bf47aa35353937d73a4b1e37cbf480612f1331d3baffe4365a2 ActionExecutor.ts
9520f703520bce3c7328d1b3cb6f0259429c4851228c1cbcd797028b4ab5c077 ActionExecutionWorker.ts
```

`git diff --check` passed at the implementation-stage check. Frozen hashes were rechecked after final commit `949c370`; all seven match the baseline and `git diff 044c990f..HEAD -- <frozen files>` is empty.

## Gate results and blockers

| Gate | Result |
|---|---|
| Source/security model inspection | PASS (manual source inspection) |
| Frozen-core stage hash verification | PASS |
| Type-check | BLOCKED: `pnpm` and installed TypeScript unavailable |
| Lint | BLOCKED: dependency toolchain unavailable |
| Tests / exact test count | BLOCKED: dependency toolchain unavailable; no count available |
| Build | BLOCKED: dependency toolchain unavailable |
| Audit | BLOCKED: no audit script is defined in root `package.json`; dependency toolchain unavailable |
| Real HTTP E2E | BLOCKED: app dependencies/dev server unavailable |
| Durable DB E2E inspection | BLOCKED: live flow not run |
| GitHub CI | NOT RUN; external billing/account limitation must remain treated as external infrastructure blocker |

## Final decision

**H8 STILL BLOCKED**

Exact blockers: install/restore the pinned pnpm workspace dependencies, execute the local type-check/lint/test/build gates, execute the requested real HTTP and durable-database cross-project/cross-workspace matrix, record exact counts/results, and perform a final frozen-core hash plus diff check after those gates. GitHub CI execution remains **BLOCKED BY ACCOUNT BILLING** unless the account issue is resolved externally; no CI/billing configuration was changed.
