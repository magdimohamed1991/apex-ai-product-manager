# APEX Operational Workflows

> This document is intentionally minimal. The real workflows are
> defined by the API contract in `apps/web/src/api-server.ts` and the
> application services in `packages/ai-core/src/application/services`.
> As the system matures, this file will be populated with concrete
> step-by-step operational procedures.

## Current runnable flows

### Sign up → onboard → run analysis → review → approve → verify

1. `POST /api/auth/signup` creates the user (scrypt-hashed password,
   secure session token) and provisions an onboarding workspace +
   default project + ownership membership.
2. `POST /api/projects/:id/repository` connects a GitHub repository
   (owner, repository, defaultBranch).
3. `POST /api/projects/:id/analysis` runs the discovery pipeline:
   - Real GitHub clone via `git clone --depth 1` when a token with a real
     GitHub PAT prefix (`ghp_`, `github_pat_`, `gho_`, `ghu_`, `ghs_`,
     `ghr_`) is configured.
   - Falls back to a local scan of the running checkout if the repository
     points at the APEX monorepo itself (a real scan of real files).
   - In development, a clearly-labeled mock scan otherwise.
   - In production, a failed/skipped clone for a non-monorepo repository
     is a HARD ERROR: the run is marked `failed` and no mock analysis is
     performed. `runAnalysis` never fabricates findings for a repository
     it could not actually read.
4. `GET /api/projects/:id/recommendations` returns the recommendations.
5. `GET /api/recommendations/:id/reasoning` returns the H4 AI reasoning.
6. `POST /api/actions/approve` approves a proposed action (body:
   `workspaceId`, `projectId`, `recommendationId`, `proposedActionId`).
   The API server promotes the proposed action into an `Action` row,
   records an `ActionTransition` audit record, and (optionally) an
   `Outcome` row. The approval is idempotent: approving the same proposed
   action twice returns the existing action without duplicating the
   transition record. (The legacy `/api/actions/:id/approve` path used a
   placeholder id segment that was ignored; it has been removed.)
7. The background worker (every 5s) polls pending actions and invokes
   the `ActionExecutor` with a workspace-scoped adapter context.
8. `POST /api/outcomes/verify` (called manually with `filesAfterChange`
   evidence) records the result of a real verification scan.

### Read-only flows

- `GET /api/auth/session` — returns the current user + workspaces.
- `GET /api/workspaces` — lists the user's workspaces.
- `GET /api/projects?workspaceId=...` — lists projects in a workspace.
- `GET /api/projects/:id/findings` — findings for a project.
- `GET /api/projects/:id/decision-metrics` — H5 metrics.
- `GET /api/projects/:id/profile` — H6 adaptive profile (if compiled).
- `GET /api/recommendations/:id/calibration?projectId=...` — H6
  calibration for a specific recommendation.
- `POST /api/projects/:id/decision-telemetry` — records a REAL PM
  decision (kind + decision-window timestamps) into the H7 telemetry
  stream. The server computes the H3/H6 scores; the decision-window
  duration drives the observed "Measured PM Decision Latency" metric.

## Background loops

- **Action execution worker** — runs every 5s. The frozen
  `ActionExecutionWorker` contract is preserved; the API server
  instantiates an `ActionExecutor` per iteration to keep the
  per-iteration failure domain small.

## What is NOT in the workflows doc

- Multi-tenant incident response (deliberately undocumented; the
  audit trail is in `ActionTransition` records and the structured
  logger output).
- Rate-limit / abuse handling (handled automatically by
  `AuthRateLimiter` and the `toSafeEnvelope` error model).
- Disaster recovery (out of scope; the supported single-process
  architecture does not survive host failure).
